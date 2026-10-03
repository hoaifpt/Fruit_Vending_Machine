CREATE TABLE dispense_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command_code VARCHAR(64) NOT NULL UNIQUE,
    order_id UUID NOT NULL,
    machine_id UUID NOT NULL,
    slot_id UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    sent_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id, machine_id) REFERENCES orders(id, machine_id) ON DELETE RESTRICT,
    FOREIGN KEY (slot_id, machine_id) REFERENCES machine_slots(id, machine_id) ON DELETE RESTRICT,
    FOREIGN KEY (inventory_item_id, slot_id) REFERENCES inventory_items(id, slot_id) ON DELETE RESTRICT,
    CONSTRAINT ck_dispense_commands_code CHECK (btrim(command_code) <> ''),
    CONSTRAINT ck_dispense_commands_status CHECK (status IN (
        'PENDING', 'SENT', 'ACKNOWLEDGED', 'SUCCESS', 'FAILED', 'TIMEOUT')),
    CONSTRAINT ck_dispense_commands_sent CHECK (sent_at IS NULL OR sent_at >= created_at),
    CONSTRAINT ck_dispense_commands_ack CHECK (
        acknowledged_at IS NULL OR (sent_at IS NOT NULL AND acknowledged_at >= sent_at)),
    CONSTRAINT ck_dispense_commands_completion CHECK (
        completed_at IS NULL OR (sent_at IS NOT NULL AND completed_at >= sent_at)),
    CONSTRAINT ck_dispense_commands_success CHECK (status <> 'SUCCESS' OR completed_at IS NOT NULL),
    CONSTRAINT ck_dispense_commands_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    -- Location snapshot; both NULL for inventory outside a machine.
    machine_id UUID,
    slot_id UUID,
    type VARCHAR(16) NOT NULL,
    reference_id UUID,
    performed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (slot_id, machine_id) REFERENCES machine_slots(id, machine_id)
        MATCH FULL ON DELETE RESTRICT,
    CONSTRAINT ck_inventory_transactions_type CHECK (type IN (
        'LOAD', 'RESERVE', 'SALE', 'EXPIRE', 'REMOVE', 'RETURN', 'ADJUSTMENT')),
    CONSTRAINT ck_inventory_transactions_location CHECK (
        type NOT IN ('LOAD', 'RESERVE', 'SALE') OR (slot_id IS NOT NULL AND machine_id IS NOT NULL))
);

-- Small integrity guard, not a workflow trigger. Corrections append an ADJUSTMENT.
CREATE FUNCTION reject_inventory_history_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'inventory_transactions is append-only; append an ADJUSTMENT instead'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER inventory_transactions_append_only
    BEFORE UPDATE OR DELETE OR TRUNCATE ON inventory_transactions
    FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_history_mutation();

CREATE TABLE machine_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    -- Extensible event vocabulary, including firmware/vendor-specific events.
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_machine_events_type CHECK (btrim(event_type) <> '')
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    -- Polymorphic historical reference, intentionally without an FK.
    entity_id UUID NOT NULL,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_audit_logs_action CHECK (btrim(action) <> ''),
    CONSTRAINT ck_audit_logs_entity_type CHECK (btrim(entity_type) <> '')
);
