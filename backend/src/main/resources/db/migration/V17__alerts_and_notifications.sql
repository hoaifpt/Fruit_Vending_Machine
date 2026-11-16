-- Issue #58. Alerts get a slot, an error code, a de-duplication key (at most one unresolved alert per problem), acknowledgement
-- and a resolution note; HARDWARE_FAULT joins the type vocabulary. Notifications tell users with ALERT_NOTIFY about new alerts.
ALTER TABLE alerts
    ADD COLUMN slot_id UUID,
    ADD COLUMN error_code VARCHAR(64),
    ADD COLUMN dedupe_key VARCHAR(160),
    ADD COLUMN acknowledged_at TIMESTAMPTZ,
    ADD COLUMN acknowledged_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN resolution_note VARCHAR(500),
    ADD CONSTRAINT fk_alerts_slot FOREIGN KEY (slot_id, machine_id)
        REFERENCES machine_slots (id, machine_id) ON DELETE RESTRICT,
    ADD CONSTRAINT ck_alerts_error_code CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    ADD CONSTRAINT ck_alerts_ack CHECK (
        (acknowledged_at IS NULL AND acknowledged_by IS NULL) OR acknowledged_at >= triggered_at),
    ADD CONSTRAINT ck_alerts_resolution_note CHECK (resolution_note IS NULL OR btrim(resolution_note) <> '');

-- Rows written before this migration (only the development seed) cannot be matched to a problem: each gets its own key.
UPDATE alerts SET dedupe_key = 'LEGACY:' || id WHERE dedupe_key IS NULL;
ALTER TABLE alerts ALTER COLUMN dedupe_key SET NOT NULL;
ALTER TABLE alerts ADD CONSTRAINT ck_alerts_dedupe_key CHECK (btrim(dedupe_key) <> '');

-- At most one unresolved alert per problem.
CREATE UNIQUE INDEX uq_alerts_open_dedupe ON alerts (dedupe_key) WHERE status <> 'RESOLVED';
CREATE INDEX ix_alerts_slot ON alerts (slot_id) WHERE slot_id IS NOT NULL;
CREATE INDEX ix_alerts_acknowledger ON alerts (acknowledged_by) WHERE acknowledged_by IS NOT NULL;

ALTER TABLE alerts DROP CONSTRAINT ck_alerts_type;
ALTER TABLE alerts ADD CONSTRAINT ck_alerts_type CHECK (type IN (
    'HIGH_TEMPERATURE', 'LOW_TEMPERATURE', 'HIGH_HUMIDITY', 'MACHINE_OFFLINE',
    'PRODUCT_EXPIRED', 'PRODUCT_EXPIRING', 'DISPENSE_FAILED', 'LOW_STOCK', 'HARDWARE_FAULT'));

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_id UUID REFERENCES alerts(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    message VARCHAR(1000),
    severity VARCHAR(16) NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_notifications_title CHECK (btrim(title) <> ''),
    CONSTRAINT ck_notifications_severity CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    CONSTRAINT ck_notifications_read CHECK (read_at IS NULL OR read_at >= created_at)
);
CREATE INDEX ix_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX ix_notifications_user_time ON notifications (user_id, created_at DESC);
CREATE INDEX ix_notifications_alert ON notifications (alert_id) WHERE alert_id IS NOT NULL;

-- Permissions (fixed UUIDs, like V13/V16): STAFF reads and handles alerts; only ADMIN is notified by default.
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000017', 'ALERT_READ', 'List and view alerts'),
    ('20000000-0000-0000-0000-000000000018', 'ALERT_MANAGE', 'Acknowledge and resolve alerts'),
    ('20000000-0000-0000-0000-000000000019', 'ALERT_NOTIFY', 'Receive a portal notification for every new alert');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000017'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000018'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000019'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000017'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000018');
