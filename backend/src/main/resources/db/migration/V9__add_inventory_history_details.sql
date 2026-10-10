-- V6 history is per physical item. Keep legacy rows unchanged: missing facts cannot be reconstructed.
ALTER TABLE inventory_transactions
    ADD COLUMN reason VARCHAR(500),
    ADD COLUMN status_before VARCHAR(24),
    ADD COLUMN status_after VARCHAR(24),
    ADD CONSTRAINT ck_inventory_transactions_reason CHECK (reason IS NULL OR btrim(reason) <> ''),
    ADD CONSTRAINT ck_inventory_transactions_status_before CHECK (status_before IS NULL OR status_before IN (
        'AVAILABLE', 'RESERVED', 'SOLD', 'EXPIRED', 'REMOVED', 'DISPENSE_FAILED')),
    ADD CONSTRAINT ck_inventory_transactions_status_after CHECK (status_after IS NULL OR status_after IN (
        'AVAILABLE', 'RESERVED', 'SOLD', 'EXPIRED', 'REMOVED', 'DISPENSE_FAILED')),
    ADD CONSTRAINT ck_inventory_transactions_status_snapshot CHECK (status_before IS NULL OR status_after IS NOT NULL);

-- Existing append-only trigger and location/actor/item FKs remain in force.
