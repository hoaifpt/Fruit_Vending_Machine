-- Issue #52. A machine slot is one physical column of the prototype (A or B), and a dispense command records why it failed.

-- 1. Slot codes. Only codes that name a column without doubt are renamed ('A1' -> 'A', 'B1' -> 'B', any case, surrounding
--    spaces ignored). Anything else stops the migration: the backend cannot know which physical column 'A2' or 'C1' is.
--    inventory_items, inventory_transactions and dispense_commands reference slots by id, so a rename loses no history.
DO $$
DECLARE
    problem TEXT;
    renamed RECORD;
BEGIN
    SELECT string_agg(format('machine %s: %s', code, codes), '; ' ORDER BY code) INTO problem
    FROM (SELECT m.code, string_agg(quote_literal(s.slot_code), ', ' ORDER BY s.slot_code) AS codes
          FROM machine_slots s JOIN machines m ON m.id = s.machine_id
          WHERE upper(btrim(s.slot_code)) NOT IN ('A', 'B', 'A1', 'B1')
          GROUP BY m.code) unknown;
    IF problem IS NOT NULL THEN
        RAISE EXCEPTION 'V14 stopped: slot codes must be the physical column A or B. Rename or remove these slots first (%)', problem
            USING HINT = 'Each machine may keep at most one slot per column. Nothing was changed.';
    END IF;

    SELECT string_agg(format('machine %s column %s: %s', code, col, codes), '; ' ORDER BY code, col) INTO problem
    FROM (SELECT m.code, left(upper(btrim(s.slot_code)), 1) AS col, string_agg(quote_literal(s.slot_code), ', ' ORDER BY s.slot_code) AS codes
          FROM machine_slots s JOIN machines m ON m.id = s.machine_id
          GROUP BY m.code, left(upper(btrim(s.slot_code)), 1)
          HAVING count(*) > 1) duplicate;
    IF problem IS NOT NULL THEN
        RAISE EXCEPTION 'V14 stopped: several slots of one machine would become the same column. Resolve them first (%)', problem
            USING HINT = 'Each machine may keep at most one slot per column. Nothing was changed.';
    END IF;

    FOR renamed IN
        SELECT s.id, m.code AS machine_code, s.slot_code AS old_code, left(upper(btrim(s.slot_code)), 1) AS new_code
        FROM machine_slots s JOIN machines m ON m.id = s.machine_id
        WHERE s.slot_code NOT IN ('A', 'B')
        ORDER BY m.code, s.slot_code
    LOOP
        UPDATE machine_slots SET slot_code = renamed.new_code, updated_at = GREATEST(updated_at, CURRENT_TIMESTAMP) WHERE id = renamed.id;
        RAISE NOTICE 'V14: machine % slot % renamed to %', renamed.machine_code, quote_literal(renamed.old_code), renamed.new_code;
    END LOOP;
END;
$$;

ALTER TABLE machine_slots
    ADD CONSTRAINT ck_machine_slots_column CHECK (slot_code IN ('A', 'B'));

-- 2. Failure reason of a dispense command. Extensible vocabulary validated by the application (like payments.provider);
--    the database only guarantees that every FAILED/TIMEOUT command has one and no other command does.
ALTER TABLE dispense_commands
    ADD COLUMN failure_reason VARCHAR(48);

-- Commands that failed before this column existed: the reason was never recorded.
UPDATE dispense_commands SET failure_reason = 'LEGACY_UNKNOWN' WHERE status IN ('FAILED', 'TIMEOUT');

ALTER TABLE dispense_commands
    ADD CONSTRAINT ck_dispense_commands_failure_reason CHECK (
        (status IN ('FAILED', 'TIMEOUT')) = (failure_reason IS NOT NULL)),
    ADD CONSTRAINT ck_dispense_commands_failure_reason_text CHECK (
        failure_reason IS NULL OR btrim(failure_reason) <> '');

-- "Is another command of this machine in flight?" is asked before every publish.
CREATE INDEX ix_dispense_commands_machine_in_flight ON dispense_commands (machine_id)
    WHERE status IN ('SENT', 'ACKNOWLEDGED');
