-- Issue #70. Recurring maintenance plans per machine; the system creates one MAINTENANCE work order (source SCHEDULE) per due
-- occurrence. Dates are business-zone dates (Asia/Ho_Chi_Minh); due_time is a local time in that zone.

CREATE TABLE maintenance_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    title VARCHAR(200) NOT NULL,
    instructions VARCHAR(2000),
    interval_days INTEGER NOT NULL,
    lead_days INTEGER NOT NULL DEFAULT 0,
    due_time TIME NOT NULL DEFAULT '17:00',
    priority VARCHAR(8) NOT NULL DEFAULT 'NORMAL',
    default_assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    next_due_date DATE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_completed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_maintenance_plans_title CHECK (btrim(title) <> ''),
    CONSTRAINT ck_maintenance_plans_instructions CHECK (instructions IS NULL OR btrim(instructions) <> ''),
    CONSTRAINT ck_maintenance_plans_interval CHECK (interval_days BETWEEN 1 AND 365),
    CONSTRAINT ck_maintenance_plans_lead CHECK (lead_days BETWEEN 0 AND 30 AND lead_days < interval_days),
    CONSTRAINT ck_maintenance_plans_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'))
);
CREATE INDEX ix_maintenance_plans_due ON maintenance_plans (next_due_date) WHERE active;
CREATE INDEX ix_maintenance_plans_machine ON maintenance_plans (machine_id);
CREATE INDEX ix_maintenance_plans_assignee ON maintenance_plans (default_assignee_id) WHERE default_assignee_id IS NOT NULL;
CREATE INDEX ix_maintenance_plans_created_by ON maintenance_plans (created_by);

-- Work orders created by the system without a plan used source SCHEDULE before this issue only in tests; a real one would stop here.
ALTER TABLE work_orders
    ADD COLUMN maintenance_plan_id UUID REFERENCES maintenance_plans(id) ON DELETE RESTRICT,
    ADD COLUMN scheduled_for DATE,
    ADD CONSTRAINT ck_work_orders_schedule CHECK (
        (source = 'SCHEDULE') = (maintenance_plan_id IS NOT NULL AND scheduled_for IS NOT NULL)),
    ADD CONSTRAINT ck_work_orders_schedule_type CHECK (maintenance_plan_id IS NULL OR type = 'MAINTENANCE');

-- One work order per plan occurrence (idempotent generation) and at most one unfinished work order per plan.
CREATE UNIQUE INDEX uq_work_orders_plan_occurrence ON work_orders (maintenance_plan_id, scheduled_for)
    WHERE maintenance_plan_id IS NOT NULL;
CREATE UNIQUE INDEX uq_work_orders_plan_open ON work_orders (maintenance_plan_id)
    WHERE maintenance_plan_id IS NOT NULL AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS');

-- Permissions (fixed UUIDs, like V13..V21).
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000032', 'MAINTENANCE_PLAN_READ', 'View maintenance plans and upcoming maintenance'),
    ('20000000-0000-0000-0000-000000000033', 'MAINTENANCE_PLAN_MANAGE', 'Create, change, activate, deactivate maintenance plans and generate their work orders');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000032'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000033'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000032');
