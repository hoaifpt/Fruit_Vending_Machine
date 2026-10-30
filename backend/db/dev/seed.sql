\set ON_ERROR_STOP on
-- DEVELOPMENT/TEST ONLY. Explicit execution with psql; never a Flyway migration.
-- Idempotent: rows are matched by natural key and rerunning skips what already exists (stock is not topped up).
-- Accounts and kiosk keys are intentionally absent: use INITIAL_ADMIN_* and the API so no shared secret is committed.
BEGIN;

-- DEV-MACHINE-01 A1/A2 are the two physical columns of the ESP32 test rig; B1 holds an expired head (not sellable).
INSERT INTO machines (id, code, name, location, status, last_seen_at) VALUES
    ('20000000-0000-0000-0000-000000000001', 'DEV-MACHINE-01', 'Development fruit machine', 'Local development', 'ACTIVE', CURRENT_TIMESTAMP),
    ('20000000-0000-0000-0000-000000000002', 'DEV-MACHINE-02', 'Maintenance test machine', 'Local development', 'MAINTENANCE', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO machine_slots (id, machine_id, slot_code, capacity)
SELECT v.id::UUID, m.id, v.slot_code, v.capacity
FROM (VALUES
    ('30000000-0000-0000-0000-000000000001', 'DEV-MACHINE-01', 'A1', 10),
    ('30000000-0000-0000-0000-000000000002', 'DEV-MACHINE-01', 'A2', 10),
    ('30000000-0000-0000-0000-000000000003', 'DEV-MACHINE-01', 'B1', 10),
    ('30000000-0000-0000-0000-000000000004', 'DEV-MACHINE-02', 'A1', 8),
    ('30000000-0000-0000-0000-000000000005', 'DEV-MACHINE-02', 'A2', 8)) AS v(id, machine_code, slot_code, capacity)
JOIN machines m ON m.code = v.machine_code
ON CONFLICT DO NOTHING;

INSERT INTO products (id, sku, name, description, price, status) VALUES
    ('40000000-0000-0000-0000-000000000001', 'DEV-MIXED-FRUIT', 'Mixed fruit bowl', 'Development sample', 35000.00, 'ACTIVE'),
    ('40000000-0000-0000-0000-000000000002', 'DEV-WATERMELON', 'Watermelon bowl', 'Development sample', 25000.00, 'ACTIVE'),
    ('40000000-0000-0000-0000-000000000003', 'DEV-PINEAPPLE', 'Pineapple bowl', 'Development sample', 30000.00, 'ACTIVE'),
    ('40000000-0000-0000-0000-000000000004', 'DEV-MANGO', 'Mango bowl', 'Development sample', 40000.00, 'ACTIVE'),
    ('40000000-0000-0000-0000-000000000005', 'DEV-PAPAYA', 'Papaya bowl', 'Development sample (inactive)', 28000.00, 'INACTIVE')
ON CONFLICT DO NOTHING;

-- Expiry is relative to the first run; the mango batch is already expired so B1 exercises the expired-head path.
INSERT INTO product_batches (id, batch_code, product_id, manufactured_at, expires_at, quantity)
SELECT v.id::UUID, v.batch_code, p.id, CURRENT_TIMESTAMP + v.made, CURRENT_TIMESTAMP + v.expires, v.quantity
FROM (VALUES
    ('50000000-0000-0000-0000-000000000001', 'SEED-MIXED-01', 'DEV-MIXED-FRUIT', INTERVAL '-1 day', INTERVAL '30 days', 20),
    ('50000000-0000-0000-0000-000000000002', 'SEED-WATERMELON-01', 'DEV-WATERMELON', INTERVAL '-1 day', INTERVAL '30 days', 20),
    ('50000000-0000-0000-0000-000000000003', 'SEED-PINEAPPLE-01', 'DEV-PINEAPPLE', INTERVAL '-2 days', INTERVAL '20 hours', 10),
    ('50000000-0000-0000-0000-000000000004', 'SEED-MANGO-EXPIRED', 'DEV-MANGO', INTERVAL '-5 days', INTERVAL '-1 day', 5))
    AS v(id, batch_code, sku, made, expires, quantity)
JOIN products p ON p.sku = v.sku
ON CONFLICT DO NOTHING;

-- Deterministic ids keep reruns from duplicating bowls; one LOAD operation per slot, as the API records it.
CREATE TEMP TABLE seed_stock ON COMMIT DROP AS
SELECT md5('fruit-seed-item:' || v.machine_code || ':' || v.slot_code || ':' || n)::UUID AS item_id,
       md5('fruit-seed-load:' || v.machine_code || ':' || v.slot_code)::UUID AS operation_id,
       s.id AS slot_id, s.machine_id, b.id AS batch_id,
       CURRENT_TIMESTAMP - v.loaded_ago + n * INTERVAL '1 second' AS loaded_at
FROM (VALUES
    ('DEV-MACHINE-01', 'A1', 'SEED-MIXED-01', 8, INTERVAL '1 day'),
    ('DEV-MACHINE-01', 'A2', 'SEED-WATERMELON-01', 6, INTERVAL '1 day'),
    ('DEV-MACHINE-01', 'B1', 'SEED-MANGO-EXPIRED', 2, INTERVAL '3 days'),
    ('DEV-MACHINE-02', 'A1', 'SEED-PINEAPPLE-01', 4, INTERVAL '1 day'),
    ('DEV-MACHINE-02', 'A2', 'SEED-WATERMELON-01', 1, INTERVAL '1 day'))
    AS v(machine_code, slot_code, batch_code, quantity, loaded_ago)
JOIN machines m ON m.code = v.machine_code
JOIN machine_slots s ON s.machine_id = m.id AND s.slot_code = v.slot_code
JOIN product_batches b ON b.batch_code = v.batch_code
CROSS JOIN LATERAL generate_series(1, v.quantity) AS n;

INSERT INTO inventory_items (id, batch_id, slot_id, status, loaded_at)
SELECT item_id, batch_id, slot_id, 'AVAILABLE', loaded_at FROM seed_stock
ON CONFLICT DO NOTHING;

INSERT INTO inventory_transactions (id, inventory_item_id, machine_id, slot_id, type, reference_id, reason, status_after)
SELECT md5('fruit-seed-tx:' || item_id)::UUID, item_id, machine_id, slot_id, 'LOAD', operation_id, 'Development seed', 'AVAILABLE'
FROM seed_stock
ON CONFLICT DO NOTHING;

-- 24 hourly readings with one spike above temperature_max (8.00) two hours ago.
INSERT INTO sensor_readings (machine_id, temperature, humidity, recorded_at)
SELECT m.id, CASE WHEN h = 2 THEN 9.50 ELSE 4.00 + (h % 4) * 0.50 END, 60 + (h % 5), CURRENT_TIMESTAMP - h * INTERVAL '1 hour'
FROM machines m
CROSS JOIN generate_series(0, 23) AS h
WHERE m.code = 'DEV-MACHINE-01'
  AND NOT EXISTS (SELECT 1 FROM sensor_readings r WHERE r.machine_id = m.id);

INSERT INTO alerts (id, machine_id, type, severity, title, message, triggered_at)
SELECT '60000000-0000-0000-0000-000000000001', m.id, 'HIGH_TEMPERATURE', 'WARNING', 'Temperature above range',
       'Seeded reading of 9.50 C exceeds the 8.00 C maximum.', CURRENT_TIMESTAMP - INTERVAL '2 hours'
FROM machines m
WHERE m.code = 'DEV-MACHINE-01'
ON CONFLICT DO NOTHING;

COMMIT;
