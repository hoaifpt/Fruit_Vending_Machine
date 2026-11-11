\set ON_ERROR_STOP on
-- DEVELOPMENT ONLY. Explicit execution; never a Flyway migration.
BEGIN;

INSERT INTO roles (id, name, description) VALUES
    ('10000000-0000-0000-0000-000000000001', 'ADMIN', 'System administrator'),
    ('10000000-0000-0000-0000-000000000002', 'STAFF', 'Machine operations and inventory staff')
ON CONFLICT (name) DO NOTHING;

INSERT INTO machines (id, code, name, location) VALUES
    ('20000000-0000-0000-0000-000000000001', 'DEV-MACHINE-01', 'Development fruit machine', 'Local development')
ON CONFLICT (code) DO NOTHING;

INSERT INTO machine_slots (id, machine_id, slot_code, capacity)
SELECT v.id::UUID, m.id, v.slot_code, 10
FROM machines m
CROSS JOIN (VALUES
    ('30000000-0000-0000-0000-000000000001', 'A1'),
    ('30000000-0000-0000-0000-000000000002', 'A2'),
    ('30000000-0000-0000-0000-000000000003', 'B1')) AS v(id, slot_code)
WHERE m.code = 'DEV-MACHINE-01'
ON CONFLICT (machine_id, slot_code) DO NOTHING;

INSERT INTO products (id, sku, name, description, price) VALUES
    ('40000000-0000-0000-0000-000000000001', 'DEV-MIXED-FRUIT', 'Mixed fruit bowl', 'Development sample', 35000.00),
    ('40000000-0000-0000-0000-000000000002', 'DEV-WATERMELON', 'Watermelon bowl', 'Development sample', 25000.00)
ON CONFLICT (sku) DO NOTHING;

COMMIT;
