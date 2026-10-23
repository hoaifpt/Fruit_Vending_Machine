-- One physical bowl per new order. Do not rewrite historical rows on upgrade.
CREATE UNIQUE INDEX uq_dispense_commands_order ON dispense_commands(order_id);
ALTER TABLE dispense_commands ADD COLUMN dispatch_token UUID;
ALTER TABLE dispense_commands ADD COLUMN bowl_count_before BIGINT;
ALTER TABLE dispense_commands ADD COLUMN bowl_count_after BIGINT;
ALTER TABLE dispense_commands ADD CONSTRAINT ck_dispense_evidence CHECK (
    (bowl_count_before IS NULL AND bowl_count_after IS NULL) OR
    (bowl_count_before IS NOT NULL AND bowl_count_after IS NOT NULL AND
     bowl_count_before BETWEEN 0 AND 4294967295 AND bowl_count_after BETWEEN 0 AND 4294967295));
CREATE INDEX ix_dispense_pending_machine ON dispense_commands(machine_id, status, created_at);
