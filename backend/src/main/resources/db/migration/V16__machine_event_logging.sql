-- Issue #56. machine_events becomes the history of what each machine reported (source MACHINE, one row per MQTT message id)
-- and what the backend decided about it (source BACKEND). Nothing wrote to the table before this migration, but any existing
-- row has no message id and cannot be tied to a machine message, so it is kept and marked BACKEND (documented choice).
ALTER TABLE machine_events
    ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'MACHINE',
    ADD COLUMN message_id VARCHAR(64);

UPDATE machine_events SET source = 'BACKEND' WHERE message_id IS NULL;

ALTER TABLE machine_events
    ADD CONSTRAINT ck_machine_events_source CHECK (source IN ('MACHINE', 'BACKEND')),
    ADD CONSTRAINT ck_machine_events_message_id CHECK (
        (source = 'MACHINE' AND message_id IS NOT NULL AND btrim(message_id) <> '')
        OR source = 'BACKEND');

-- One row per machine message, even when MQTT redelivers it.
CREATE UNIQUE INDEX uq_machine_events_machine_message
    ON machine_events (machine_id, message_id) WHERE message_id IS NOT NULL;

CREATE INDEX ix_machine_events_machine_type_time
    ON machine_events (machine_id, event_type, created_at DESC);

-- Read access to the audit log, ADMIN only (fixed UUID, like V13).
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000016', 'AUDIT_LOG_READ', 'List and view the audit log');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000016');
