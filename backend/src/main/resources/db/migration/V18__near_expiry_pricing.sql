-- Issue #61. Near-expiry discount: an Admin-managed singleton setting, price snapshots on orders and order items
-- (original price, discount, price paid), and the PRICING_READ / PRICING_MANAGE permissions.

CREATE TABLE pricing_settings (
    id UUID PRIMARY KEY,
    near_expiry_enabled BOOLEAN NOT NULL,
    near_expiry_percent SMALLINT NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    singleton BOOLEAN NOT NULL DEFAULT TRUE UNIQUE,
    CONSTRAINT ck_pricing_settings_singleton CHECK (singleton),
    CONSTRAINT ck_pricing_settings_percent CHECK (near_expiry_percent BETWEEN 1 AND 90)
);
CREATE INDEX ix_pricing_settings_updated_by ON pricing_settings (updated_by) WHERE updated_by IS NOT NULL;

INSERT INTO pricing_settings (id, near_expiry_enabled, near_expiry_percent)
VALUES (gen_random_uuid(), TRUE, 50);

-- Every existing order was charged its full price (subtotal = total_amount). Anything else is a data problem: stop here
-- with a clear message instead of rewriting amounts that may already have been paid.
DO $$
DECLARE
    mismatched BIGINT;
BEGIN
    SELECT count(*) INTO mismatched FROM orders WHERE total_amount <> subtotal;
    IF mismatched > 0 THEN
        RAISE EXCEPTION 'V18: % order(s) have total_amount <> subtotal; fix them manually before applying the discount schema', mismatched;
    END IF;
END $$;

ALTER TABLE orders
    ADD COLUMN discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_orders_discount CHECK (
        discount_amount BETWEEN 0 AND subtotal AND total_amount = subtotal - discount_amount);

ALTER TABLE order_items
    ADD COLUMN original_unit_price NUMERIC(12,2),
    ADD COLUMN discount_percent SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN discount_reason VARCHAR(24) NOT NULL DEFAULT 'NONE';

UPDATE order_items SET original_unit_price = unit_price WHERE original_unit_price IS NULL;

ALTER TABLE order_items
    ALTER COLUMN original_unit_price SET NOT NULL,
    ADD CONSTRAINT ck_order_items_discount CHECK (
        discount_percent BETWEEN 0 AND 90
        AND discount_reason IN ('NONE', 'NEAR_EXPIRY')
        AND unit_price <= original_unit_price
        AND ((discount_reason = 'NONE' AND discount_percent = 0 AND unit_price = original_unit_price)
          OR (discount_reason <> 'NONE' AND discount_percent > 0)));

-- Admin-filtered order lists (discounted=true|false).
CREATE INDEX ix_orders_discounted_time ON orders (created_at DESC) WHERE discount_amount > 0;

-- Permissions (fixed UUIDs, like V13/V16/V17): STAFF can see the setting, only ADMIN changes it.
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000020', 'PRICING_READ', 'View the near-expiry discount setting'),
    ('20000000-0000-0000-0000-000000000021', 'PRICING_MANAGE', 'Change the near-expiry discount setting');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000020'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000021'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000020');
