-- Issue #68. Restock workflow on top of work orders: planned lines (slot, product, quantity) with a cached loaded counter,
-- maintenance commands linked to the work order they serve, and loading moved behind work orders (direct load: ADMIN only).

CREATE TABLE restock_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
    machine_id UUID NOT NULL,
    slot_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    planned_quantity INTEGER NOT NULL,
    loaded_quantity INTEGER NOT NULL DEFAULT 0,
    variance_reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_restock_lines_slot FOREIGN KEY (slot_id, machine_id)
        REFERENCES machine_slots (id, machine_id) ON DELETE RESTRICT,
    CONSTRAINT uq_restock_lines_slot_product UNIQUE (work_order_id, slot_id, product_id),
    CONSTRAINT ck_restock_lines_planned CHECK (planned_quantity BETWEEN 0 AND 1000),
    CONSTRAINT ck_restock_lines_loaded CHECK (loaded_quantity BETWEEN 0 AND 1000),
    CONSTRAINT ck_restock_lines_variance CHECK (variance_reason IS NULL OR btrim(variance_reason) <> '')
);
CREATE INDEX ix_restock_lines_work_order ON restock_lines (work_order_id);
CREATE INDEX ix_restock_lines_slot ON restock_lines (slot_id);
CREATE INDEX ix_restock_lines_product ON restock_lines (product_id);

ALTER TABLE maintenance_commands
    ADD COLUMN work_order_id UUID REFERENCES work_orders(id) ON DELETE RESTRICT;
CREATE INDEX ix_maintenance_commands_work_order ON maintenance_commands (work_order_id);

-- LOAD history of a restock line: inventory_transactions.reference_id = line id.
CREATE INDEX ix_inventory_transactions_reference ON inventory_transactions (reference_id) WHERE reference_id IS NOT NULL;

-- Permissions (fixed UUIDs, like V13..V20).
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000029', 'RESTOCK_PLAN', 'Restock suggestions and planning of restock lines'),
    ('20000000-0000-0000-0000-000000000030', 'RESTOCK_EXECUTE', 'Load bowls against a line of an IN_PROGRESS restock work order'),
    ('20000000-0000-0000-0000-000000000031', 'INVENTORY_LOAD_DIRECT', 'Load bowls without a work order (POST /api/v1/inventory/load)');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000029'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000030'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000031'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000030');
