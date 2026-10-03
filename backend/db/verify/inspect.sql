\set ON_ERROR_STOP on
SELECT version();
SELECT installed_rank, version, description, checksum, success
FROM flyway_schema_history ORDER BY installed_rank;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;

SELECT name FROM roles ORDER BY name;
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' ORDER BY tablename, indexname;

-- Current physical stock includes expired/failed items until staff remove them.
SELECT s.machine_id, i.slot_id, i.status, count(*) AS bowls
FROM inventory_items i JOIN machine_slots s ON s.id = i.slot_id
WHERE i.status IN ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED')
GROUP BY s.machine_id, i.slot_id, i.status;

-- Saleable stock: AVAILABLE alone is insufficient (expiry can pass without a write).
SELECT s.machine_id, i.slot_id, b.product_id, count(*) AS saleable_bowls
FROM inventory_items i
JOIN machine_slots s ON s.id = i.slot_id
JOIN machines m ON m.id = s.machine_id
JOIN product_batches b ON b.id = i.batch_id
JOIN products p ON p.id = b.product_id
WHERE i.status = 'AVAILABLE' AND b.expires_at > CURRENT_TIMESTAMP
  AND m.status = 'ACTIVE' AND s.status = 'ACTIVE' AND p.status = 'ACTIVE'
GROUP BY s.machine_id, i.slot_id, b.product_id;

SELECT i.id, i.status, i.slot_id, b.expires_at
FROM inventory_items i JOIN product_batches b ON b.id = i.batch_id
WHERE i.status IN ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED')
  AND b.expires_at <= CURRENT_TIMESTAMP ORDER BY b.expires_at;

SELECT i.id, i.slot_id, b.expires_at
FROM inventory_items i JOIN product_batches b ON b.id = i.batch_id
WHERE i.status = 'AVAILABLE' AND i.slot_id IS NOT NULL
  AND b.expires_at > CURRENT_TIMESTAMP
  AND b.expires_at <= CURRENT_TIMESTAMP + INTERVAL '6 hours'
ORDER BY b.expires_at;

SELECT m.code, r.temperature, r.humidity, r.recorded_at
FROM machines m LEFT JOIN LATERAL (
    SELECT temperature, humidity, recorded_at FROM sensor_readings
    WHERE machine_id = m.id ORDER BY recorded_at DESC LIMIT 1
) r ON TRUE;

-- Consistency diagnostics for cross-table rules owned by the future service.
SELECT oi.id, oi.quantity, count(a.id) AS live_allocations
FROM order_items oi LEFT JOIN order_item_allocations a
  ON a.order_item_id = oi.id AND a.status IN ('RESERVED', 'DISPENSED')
GROUP BY oi.id HAVING count(a.id) > oi.quantity;

SELECT a.id AS invalid_allocation
FROM order_item_allocations a
JOIN order_items oi ON oi.id = a.order_item_id
JOIN orders o ON o.id = oi.order_id
JOIN inventory_items i ON i.id = a.inventory_item_id
JOIN product_batches b ON b.id = i.batch_id
LEFT JOIN machine_slots s ON s.id = i.slot_id
WHERE a.status IN ('RESERVED', 'DISPENSED')
  AND (b.product_id <> oi.product_id OR s.machine_id IS DISTINCT FROM o.machine_id);

SELECT c.id AS command_without_live_allocation
FROM dispense_commands c
WHERE c.status IN ('PENDING', 'SENT', 'ACKNOWLEDGED', 'SUCCESS')
AND NOT EXISTS (
    SELECT 1 FROM order_item_allocations a JOIN order_items oi ON oi.id = a.order_item_id
    WHERE oi.order_id = c.order_id AND a.inventory_item_id = c.inventory_item_id
      AND a.status IN ('RESERVED', 'DISPENSED')
);
