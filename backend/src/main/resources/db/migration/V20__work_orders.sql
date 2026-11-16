-- Issue #66. Work orders (RESTOCK, MAINTENANCE, INCIDENT): lifecycle, assignment, links to alerts, an append-only history,
-- notifications about work orders, and the permissions to read, manage and execute them.

CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    type VARCHAR(16) NOT NULL,
    source VARCHAR(24) NOT NULL,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(2000),
    priority VARCHAR(8) NOT NULL DEFAULT 'NORMAL',
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    due_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE RESTRICT,      -- NULL = system
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    result_note VARCHAR(2000),
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    cancel_reason VARCHAR(500),
    overdue_notified_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_work_orders_code CHECK (code ~ '^WO-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{4,8}$'),
    CONSTRAINT ck_work_orders_type CHECK (type IN ('RESTOCK', 'MAINTENANCE', 'INCIDENT')),
    CONSTRAINT ck_work_orders_source CHECK (source IN ('MANUAL', 'ALERT', 'SCHEDULE', 'CUSTOMER_REPORT')),
    CONSTRAINT ck_work_orders_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    CONSTRAINT ck_work_orders_status CHECK (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
    CONSTRAINT ck_work_orders_title CHECK (btrim(title) <> ''),
    CONSTRAINT ck_work_orders_assignee CHECK (
        (status = 'OPEN' AND assignee_id IS NULL) OR status = 'CANCELLED' OR (status <> 'OPEN' AND assignee_id IS NOT NULL)),
    CONSTRAINT ck_work_orders_started CHECK (
        status = 'CANCELLED' OR (status IN ('IN_PROGRESS', 'DONE')) = (started_at IS NOT NULL)),
    -- COALESCE: a NULL result_note / cancel_reason must make the comparison false, not unknown (which a CHECK accepts).
    CONSTRAINT ck_work_orders_done CHECK (
        (status = 'DONE') = (completed_at IS NOT NULL AND completed_by IS NOT NULL AND COALESCE(btrim(result_note), '') <> '')),
    CONSTRAINT ck_work_orders_cancelled CHECK (
        (status = 'CANCELLED') = (cancelled_at IS NOT NULL AND COALESCE(btrim(cancel_reason), '') <> '')),
    CONSTRAINT ck_work_orders_times CHECK (
        (started_at IS NULL OR started_at >= created_at) AND (completed_at IS NULL OR completed_at >= started_at)
        AND (cancelled_at IS NULL OR cancelled_at >= created_at))
);
CREATE INDEX ix_work_orders_assignee_status ON work_orders (assignee_id, status, due_at);
CREATE INDEX ix_work_orders_machine_time ON work_orders (machine_id, created_at DESC);
CREATE INDEX ix_work_orders_status_due ON work_orders (status, due_at)
    WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS');
CREATE INDEX ix_work_orders_created_by ON work_orders (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX ix_work_orders_completed_by ON work_orders (completed_by) WHERE completed_by IS NOT NULL;
CREATE INDEX ix_work_orders_cancelled_by ON work_orders (cancelled_by) WHERE cancelled_by IS NOT NULL;

-- An alert is handled by at most one unfinished work order (enforced by WorkOrderService under the alert row lock).
CREATE TABLE work_order_alerts (
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (work_order_id, alert_id)
);
CREATE INDEX ix_work_order_alerts_alert ON work_order_alerts (alert_id);

-- Append-only history (status changes, assignment, edits, notes).
CREATE TABLE work_order_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
    type VARCHAR(24) NOT NULL,
    status_before VARCHAR(16),
    status_after VARCHAR(16),
    actor_id UUID REFERENCES users(id) ON DELETE RESTRICT,     -- NULL = system
    note VARCHAR(2000),
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_work_order_events_type CHECK (type IN (
        'CREATED', 'ASSIGNED', 'UNASSIGNED', 'STARTED', 'COMPLETED', 'CANCELLED', 'UPDATED', 'NOTE', 'OVERDUE')),
    CONSTRAINT ck_work_order_events_status CHECK (
        (status_before IS NULL OR status_before IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'))
        AND (status_after IS NULL OR status_after IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'))),
    CONSTRAINT ck_work_order_events_note CHECK (note IS NULL OR btrim(note) <> '')
);
CREATE INDEX ix_work_order_events_wo_time ON work_order_events (work_order_id, created_at);
CREATE INDEX ix_work_order_events_actor ON work_order_events (actor_id) WHERE actor_id IS NOT NULL;

-- Same guard as inventory_transactions (V6): history is never rewritten.
CREATE FUNCTION reject_work_order_event_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'work_order_events is append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER work_order_events_append_only
    BEFORE UPDATE OR DELETE OR TRUNCATE ON work_order_events
    FOR EACH STATEMENT EXECUTE FUNCTION reject_work_order_event_mutation();

ALTER TABLE notifications ADD COLUMN work_order_id UUID REFERENCES work_orders(id) ON DELETE RESTRICT;
CREATE INDEX ix_notifications_work_order ON notifications (work_order_id) WHERE work_order_id IS NOT NULL;

-- Permissions (fixed UUIDs, like V13..V19). ADMIN also holds READ_ASSIGNED: "my work orders" is one permission for everyone who
-- can be assigned work; READ_ALL additionally shows every work order.
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000025', 'WORK_ORDER_READ_ALL', 'List and view every work order'),
    ('20000000-0000-0000-0000-000000000026', 'WORK_ORDER_READ_ASSIGNED', 'View the work orders assigned to me'),
    ('20000000-0000-0000-0000-000000000027', 'WORK_ORDER_MANAGE', 'Create, edit, assign and cancel work orders'),
    ('20000000-0000-0000-0000-000000000028', 'WORK_ORDER_EXECUTE', 'Start, annotate and complete work orders assigned to me');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000025'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000026'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000027'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000028'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000026'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000028');
