CREATE INDEX ix_user_roles_role ON user_roles (role_id);
-- machine_slots(machine_id, slot_code) already supports lookup by machine.
CREATE INDEX ix_product_batches_product ON product_batches (product_id);
CREATE INDEX ix_product_batches_expiry ON product_batches (expires_at);
CREATE INDEX ix_product_batches_creator ON product_batches (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX ix_inventory_items_slot_status ON inventory_items (slot_id, status);
CREATE INDEX ix_inventory_items_batch ON inventory_items (batch_id);
CREATE INDEX ix_inventory_items_status ON inventory_items (status);

CREATE INDEX ix_sensor_readings_machine_time ON sensor_readings (machine_id, recorded_at DESC);
-- BRIN is compact for mostly time-ordered ingestion; revisit for heavy backfills.
CREATE INDEX ix_sensor_readings_time ON sensor_readings USING BRIN (recorded_at);
CREATE INDEX ix_alerts_machine_time ON alerts (machine_id, triggered_at DESC);
CREATE INDEX ix_alerts_status_time ON alerts (status, triggered_at DESC);
CREATE INDEX ix_alerts_time ON alerts (triggered_at DESC);
CREATE INDEX ix_alerts_resolver ON alerts (resolved_by) WHERE resolved_by IS NOT NULL;

CREATE INDEX ix_orders_machine_time ON orders (machine_id, created_at DESC);
CREATE INDEX ix_orders_status_time ON orders (status, created_at DESC);
CREATE INDEX ix_orders_time ON orders (created_at DESC);
CREATE INDEX ix_order_items_order ON order_items (order_id);
CREATE INDEX ix_order_items_product ON order_items (product_id);
CREATE INDEX ix_order_item_allocations_order_item ON order_item_allocations (order_item_id);
CREATE INDEX ix_order_item_allocations_inventory ON order_item_allocations (inventory_item_id);
CREATE UNIQUE INDEX uq_order_item_allocations_live_inventory
    ON order_item_allocations (inventory_item_id) WHERE status IN ('RESERVED', 'DISPENSED');
CREATE INDEX ix_payments_order_time ON payments (order_id, created_at DESC);
CREATE INDEX ix_payments_status ON payments (status);
-- NULL means no provider transaction yet. Namespaces are per provider.
CREATE UNIQUE INDEX uq_payments_provider_transaction
    ON payments (provider, transaction_id) WHERE transaction_id IS NOT NULL;
-- Keep all webhook attempts, including duplicates and failed verification.
CREATE INDEX ix_payment_webhook_logs_order_time ON payment_webhook_logs (order_code, received_at DESC);
CREATE INDEX ix_payment_webhook_logs_provider_time ON payment_webhook_logs (provider, received_at DESC);

CREATE INDEX ix_dispense_commands_machine_time ON dispense_commands (machine_id, created_at DESC);
CREATE INDEX ix_dispense_commands_order ON dispense_commands (order_id);
CREATE INDEX ix_dispense_commands_slot ON dispense_commands (slot_id);
CREATE INDEX ix_dispense_commands_status ON dispense_commands (status);
CREATE INDEX ix_dispense_commands_inventory ON dispense_commands (inventory_item_id);
CREATE UNIQUE INDEX uq_dispense_commands_live_inventory ON dispense_commands (inventory_item_id)
    WHERE status IN ('PENDING', 'SENT', 'ACKNOWLEDGED', 'SUCCESS');

CREATE INDEX ix_inventory_transactions_item_time ON inventory_transactions (inventory_item_id, created_at DESC);
CREATE INDEX ix_inventory_transactions_machine_time ON inventory_transactions (machine_id, created_at DESC);
CREATE INDEX ix_inventory_transactions_slot ON inventory_transactions (slot_id);
CREATE INDEX ix_inventory_transactions_time ON inventory_transactions (created_at DESC);
CREATE INDEX ix_inventory_transactions_actor ON inventory_transactions (performed_by) WHERE performed_by IS NOT NULL;
CREATE INDEX ix_machine_events_machine_time ON machine_events (machine_id, created_at DESC);
CREATE INDEX ix_machine_events_time ON machine_events (created_at DESC);
CREATE INDEX ix_audit_logs_user_time ON audit_logs (user_id, created_at DESC);
CREATE INDEX ix_audit_logs_entity_time ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX ix_audit_logs_time ON audit_logs (created_at DESC);
