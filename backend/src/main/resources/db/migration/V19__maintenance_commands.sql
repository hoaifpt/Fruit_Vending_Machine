-- Issue #64. Remote maintenance commands (remove the head bowl, empty a column, open/close the refill gate, RESET), one
-- unfinished command per machine, the refill gate state of each slot, and the permissions to read, run and reset.

CREATE TABLE maintenance_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command_code VARCHAR(39) NOT NULL UNIQUE,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    slot_id UUID,
    operation VARCHAR(24) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    reason VARCHAR(24),
    note VARCHAR(500),
    target_inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(64) NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    failure_reason VARCHAR(48),
    removed_count INTEGER,
    reconciled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reconciled_at TIMESTAMPTZ,
    reconciliation_outcome VARCHAR(16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_maintenance_commands_slot FOREIGN KEY (slot_id, machine_id)
        REFERENCES machine_slots (id, machine_id) ON DELETE RESTRICT,
    CONSTRAINT uq_maintenance_commands_idem UNIQUE (requested_by, idempotency_key),
    CONSTRAINT ck_maintenance_commands_code CHECK (command_code ~ '^MC-[A-Za-z0-9_-]{1,36}$'),
    CONSTRAINT ck_maintenance_commands_idem CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
    CONSTRAINT ck_maintenance_commands_operation CHECK (operation IN (
        'REMOVE_ITEM', 'EMPTY_COLUMN', 'OPEN_REFILL', 'CLOSE_REFILL', 'RESET')),
    CONSTRAINT ck_maintenance_commands_scope CHECK (
        (operation = 'RESET' AND slot_id IS NULL) OR (operation <> 'RESET' AND slot_id IS NOT NULL)),
    CONSTRAINT ck_maintenance_commands_status CHECK (status IN (
        'PENDING', 'SENT', 'ACCEPTED', 'COMPLETED', 'FAILED', 'NEEDS_RECONCILIATION', 'RECONCILED')),
    CONSTRAINT ck_maintenance_commands_reason CHECK (reason IS NULL OR reason IN (
        'EXPIRED', 'DAMAGED', 'DISPENSE_FAILED', 'RESTOCK', 'INSPECTION', 'OTHER')),
    -- Stricter than "reason <> 'OTHER' OR btrim(note) <> ''", which a NULL note would pass.
    CONSTRAINT ck_maintenance_commands_other_note CHECK (
        reason IS DISTINCT FROM 'OTHER' OR (note IS NOT NULL AND btrim(note) <> '')),
    CONSTRAINT ck_maintenance_commands_note CHECK (note IS NULL OR btrim(note) <> ''),
    -- Removing bowls always says why; REMOVE_ITEM always names the head bowl it was created for.
    CONSTRAINT ck_maintenance_commands_reason_required CHECK (
        operation NOT IN ('REMOVE_ITEM', 'EMPTY_COLUMN') OR reason IS NOT NULL),
    CONSTRAINT ck_maintenance_commands_target CHECK (
        (operation = 'REMOVE_ITEM') = (target_inventory_item_id IS NOT NULL)),
    CONSTRAINT ck_maintenance_commands_attempts CHECK (attempt_count >= 0),
    CONSTRAINT ck_maintenance_commands_removed CHECK (removed_count IS NULL OR removed_count >= 0),
    CONSTRAINT ck_maintenance_commands_reconcile CHECK (
        reconciliation_outcome IS NULL OR reconciliation_outcome IN ('DONE', 'NOT_DONE')),
    CONSTRAINT ck_maintenance_commands_reconciled CHECK (
        (status = 'RECONCILED') = (reconciliation_outcome IS NOT NULL AND reconciled_at IS NOT NULL AND reconciled_by IS NOT NULL))
);

-- At most one unfinished maintenance command per machine.
CREATE UNIQUE INDEX uq_maintenance_commands_open ON maintenance_commands (machine_id)
    WHERE status IN ('PENDING', 'SENT', 'ACCEPTED');
CREATE INDEX ix_maintenance_commands_machine_time ON maintenance_commands (machine_id, created_at DESC);
CREATE INDEX ix_maintenance_commands_status ON maintenance_commands (status, created_at)
    WHERE status IN ('PENDING', 'SENT', 'ACCEPTED', 'NEEDS_RECONCILIATION');
CREATE INDEX ix_maintenance_commands_slot ON maintenance_commands (slot_id) WHERE slot_id IS NOT NULL;
CREATE INDEX ix_maintenance_commands_target ON maintenance_commands (target_inventory_item_id) WHERE target_inventory_item_id IS NOT NULL;
CREATE INDEX ix_maintenance_commands_reconciler ON maintenance_commands (reconciled_by) WHERE reconciled_by IS NOT NULL;

ALTER TABLE machine_slots
    ADD COLUMN refill_gate_open BOOLEAN NOT NULL DEFAULT FALSE;

-- Permissions (fixed UUIDs, like V13/V16/V17/V18): STAFF runs maintenance commands, only ADMIN resets the controller.
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000022', 'MAINTENANCE_COMMAND_READ', 'List and view maintenance commands'),
    ('20000000-0000-0000-0000-000000000023', 'MAINTENANCE_COMMAND_EXECUTE', 'Send maintenance commands to machines and reconcile them'),
    ('20000000-0000-0000-0000-000000000024', 'MACHINE_RESET', 'Clear a controller fault remotely (RESET)');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000022'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000023'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000024'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000022'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000023');
