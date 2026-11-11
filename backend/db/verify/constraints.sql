\set ON_ERROR_STOP on
-- Run on a migrated development/test DB. All fixtures are rolled back.
-- Sensor identity sequence values may advance despite rollback.
BEGIN;

CREATE FUNCTION pg_temp.expect_error(statement TEXT, expected_state TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE actual_state TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
        IF actual_state = expected_state THEN RETURN; END IF;
        RAISE EXCEPTION 'Expected SQLSTATE %, got % for %', expected_state, actual_state, statement;
    END;
    RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded: %', expected_state, statement;
END;
$$;

DO $$
DECLARE
    machine_a UUID; machine_b UUID; slot_a UUID; slot_b UUID;
    product UUID; batch UUID; bowl UUID; other_bowl UUID;
    purchase UUID; line UUID; other_line UUID; allocation UUID;
    command UUID; price_snapshot NUMERIC;
    test_suffix TEXT := gen_random_uuid()::TEXT;
BEGIN
    IF (SELECT count(*) FROM flyway_schema_history WHERE success AND version IN ('1','2','3','4','5','6','7','8')) <> 8 THEN
        RAISE EXCEPTION 'Expected all eight successful Flyway migrations';
    END IF;
    IF (SELECT count(*) FROM roles WHERE name IN ('ADMIN', 'STAFF')) <> 2 THEN
        RAISE EXCEPTION 'Missing initial roles';
    END IF;

    INSERT INTO machines(code, name) VALUES ('TEST-A-' || test_suffix, 'Test A') RETURNING id INTO machine_a;
    INSERT INTO machines(code, name) VALUES ('TEST-B-' || test_suffix, 'Test B') RETURNING id INTO machine_b;
    INSERT INTO machine_slots(machine_id, slot_code, capacity) VALUES (machine_a, 'A1', 10) RETURNING id INTO slot_a;
    INSERT INTO machine_slots(machine_id, slot_code, capacity) VALUES (machine_b, 'A1', 10) RETURNING id INTO slot_b;
    INSERT INTO products(sku, name, price) VALUES ('TEST-' || test_suffix, 'Test bowl', 10) RETURNING id INTO product;
    INSERT INTO product_batches(batch_code, product_id, manufactured_at, expires_at, quantity)
    VALUES ('TEST-' || test_suffix, product, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day', 2)
    RETURNING id INTO batch;
    INSERT INTO inventory_items(batch_id, slot_id, loaded_at) VALUES (batch, slot_a, CURRENT_TIMESTAMP) RETURNING id INTO bowl;
    INSERT INTO inventory_items(batch_id, slot_id, loaded_at) VALUES (batch, slot_a, CURRENT_TIMESTAMP) RETURNING id INTO other_bowl;
    INSERT INTO orders(order_code, machine_id, subtotal, total_amount)
    VALUES ('TEST-' || test_suffix, machine_a, 20, 20) RETURNING id INTO purchase;
    INSERT INTO order_items(order_id, product_id, quantity, unit_price, total_price)
    VALUES (purchase, product, 2, 10, 20) RETURNING id INTO line;
    INSERT INTO order_items(order_id, product_id, quantity, unit_price, total_price)
    VALUES (purchase, product, 1, 10, 10) RETURNING id INTO other_line;

    PERFORM pg_temp.expect_error(format('UPDATE products SET price = -1 WHERE id = %L', product), '23514');
    PERFORM pg_temp.expect_error(format('UPDATE products SET price = ''NaN'' WHERE id = %L', product), '23514');
    PERFORM pg_temp.expect_error(format('UPDATE machines SET humidity_max = 101 WHERE id = %L', machine_a), '23514');
    PERFORM pg_temp.expect_error(format('UPDATE machines SET temperature_min = 9, temperature_max = 8 WHERE id = %L', machine_a), '23514');
    PERFORM pg_temp.expect_error(format('UPDATE machine_slots SET capacity = 0 WHERE id = %L', slot_a), '23514');
    PERFORM pg_temp.expect_error(format('INSERT INTO machine_slots(machine_id, slot_code, capacity) VALUES (%L, ''A1'', 1)', machine_a), '23505');
    PERFORM pg_temp.expect_error(format('UPDATE product_batches SET expires_at = manufactured_at WHERE id = %L', batch), '23514');
    PERFORM pg_temp.expect_error(format('UPDATE inventory_items SET status = ''UNKNOWN'' WHERE id = %L', bowl), '23514');
    PERFORM pg_temp.expect_error(format('UPDATE inventory_items SET status = ''SOLD'' WHERE id = %L', bowl), '23514');
    PERFORM pg_temp.expect_error(format('UPDATE order_items SET total_price = 11 WHERE id = %L', line), '23514');
    PERFORM pg_temp.expect_error(format('INSERT INTO sensor_readings(machine_id) VALUES (%L)', machine_a), '23514');
    PERFORM pg_temp.expect_error(format('INSERT INTO sensor_readings(machine_id, humidity) VALUES (%L, 101)', machine_a), '23514');
    INSERT INTO sensor_readings(machine_id, temperature, humidity) VALUES (machine_a, 4.25, 65);

    UPDATE products SET price = 99, updated_at = CURRENT_TIMESTAMP WHERE id = product;
    SELECT unit_price INTO price_snapshot FROM order_items WHERE id = line;
    IF price_snapshot <> 10 THEN RAISE EXCEPTION 'Historical unit price changed'; END IF;

    INSERT INTO order_item_allocations(order_item_id, inventory_item_id) VALUES (line, bowl) RETURNING id INTO allocation;
    PERFORM pg_temp.expect_error(format('INSERT INTO order_item_allocations(order_item_id, inventory_item_id) VALUES (%L, %L)', other_line, bowl), '23505');
    UPDATE order_item_allocations SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP WHERE id = allocation;
    INSERT INTO order_item_allocations(order_item_id, inventory_item_id) VALUES (line, bowl);
    INSERT INTO order_item_allocations(order_item_id, inventory_item_id) VALUES (line, other_bowl);
    IF (SELECT count(*) FROM order_item_allocations WHERE order_item_id = line AND status = 'RESERVED') <> 2 THEN
        RAISE EXCEPTION 'Expected two individual bowls allocated to a quantity-two line';
    END IF;

    -- Several attempts per order; multiple NULL transaction IDs are legal.
    INSERT INTO payments(order_id, provider, amount) VALUES (purchase, 'PAYOS', 20), (purchase, 'PAYOS', 20);
    INSERT INTO payments(order_id, provider, transaction_id, amount, status, paid_at)
    VALUES (purchase, 'PAYOS', test_suffix, 20, 'SUCCESS', CURRENT_TIMESTAMP);
    PERFORM pg_temp.expect_error(format('INSERT INTO payments(order_id, provider, transaction_id, amount) VALUES (%L, ''PAYOS'', %L, 20)', purchase, test_suffix), '23505');
    INSERT INTO payments(order_id, provider, transaction_id, amount) VALUES (purchase, 'MOMO', test_suffix, 20);
    PERFORM pg_temp.expect_error(format('INSERT INTO payments(order_id, provider, amount, status) VALUES (%L, ''PAYOS'', 20, ''SUCCESS'')', purchase), '23514');
    INSERT INTO payment_webhook_logs(provider, order_code, raw_body) VALUES ('PAYOS', 'UNKNOWN-ORDER', 'invalid-json-body');

    PERFORM pg_temp.expect_error(format('INSERT INTO dispense_commands(command_code, order_id, machine_id, slot_id, inventory_item_id) VALUES (%L, %L, %L, %L, %L)', 'BAD-' || test_suffix, purchase, machine_b, slot_b, bowl), '23503');
    PERFORM pg_temp.expect_error(format('INSERT INTO dispense_commands(command_code, order_id, machine_id, slot_id, inventory_item_id) VALUES (%L, %L, %L, %L, %L)', 'BAD-SLOT-' || test_suffix, purchase, machine_a, slot_b, bowl), '23503');
    INSERT INTO dispense_commands(command_code, order_id, machine_id, slot_id, inventory_item_id)
    VALUES ('CMD-' || test_suffix, purchase, machine_a, slot_a, bowl) RETURNING id INTO command;
    PERFORM pg_temp.expect_error(format('INSERT INTO dispense_commands(command_code, order_id, machine_id, slot_id, inventory_item_id) VALUES (%L, %L, %L, %L, %L)', 'DUP-' || test_suffix, purchase, machine_a, slot_a, bowl), '23505');
    UPDATE dispense_commands SET status = 'FAILED' WHERE id = command;
    INSERT INTO dispense_commands(command_code, order_id, machine_id, slot_id, inventory_item_id, status, sent_at, completed_at)
    VALUES ('RETRY-' || test_suffix, purchase, machine_a, slot_a, bowl, 'SUCCESS', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    PERFORM pg_temp.expect_error(format('INSERT INTO dispense_commands(command_code, order_id, machine_id, slot_id, inventory_item_id, status, sent_at, completed_at) VALUES (%L, %L, %L, %L, %L, ''SUCCESS'', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', 'DOUBLE-' || test_suffix, purchase, machine_a, slot_a, bowl), '23505');

    PERFORM pg_temp.expect_error(format('INSERT INTO inventory_transactions(inventory_item_id, machine_id, slot_id, type) VALUES (%L, %L, %L, ''LOAD'')', bowl, machine_b, slot_a), '23503');
    PERFORM pg_temp.expect_error(format('INSERT INTO inventory_transactions(inventory_item_id, machine_id, type) VALUES (%L, %L, ''ADJUSTMENT'')', bowl, machine_a), '23503');
    INSERT INTO inventory_transactions(inventory_item_id, machine_id, slot_id, type) VALUES (bowl, machine_a, slot_a, 'LOAD');
    PERFORM pg_temp.expect_error('UPDATE inventory_transactions SET type = ''ADJUSTMENT''', '55000');
    PERFORM pg_temp.expect_error('DELETE FROM inventory_transactions', '55000');
    PERFORM pg_temp.expect_error('TRUNCATE inventory_transactions', '55000');
    -- RESTRICT reports restrict_violation, distinct from an invalid FK insert.
    PERFORM pg_temp.expect_error(format('DELETE FROM products WHERE id = %L', product), '23001');
    PERFORM pg_temp.expect_error(format('DELETE FROM machines WHERE id = %L', machine_a), '23001');
    PERFORM pg_temp.expect_error(format('DELETE FROM orders WHERE id = %L', purchase), '23001');
    RAISE NOTICE 'PASS: schema, references, price snapshots, payment retries, allocations, dispensing and append-only history';
END;
$$;

ROLLBACK;
