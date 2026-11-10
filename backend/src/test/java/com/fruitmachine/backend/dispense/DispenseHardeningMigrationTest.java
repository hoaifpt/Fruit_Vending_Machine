package com.fruitmachine.backend.dispense;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Issue #52: V14 on disposable PostgreSQL 18 databases (one per scenario) with V13 data. */
class DispenseHardeningMigrationTest {
    record Database(PostgreSQLContainer<?> container, JdbcTemplate jdbc, DriverManagerDataSource source) implements AutoCloseable {
        static Database atV13() {
            var container = com.fruitmachine.backend.support.TestPostgres.create();
            container.start();
            var source = new DriverManagerDataSource(container.getJdbcUrl(), container.getUsername(), container.getPassword());
            Flyway.configure().dataSource(source).target("13").load().migrate();
            return new Database(container, new JdbcTemplate(source), source);
        }

        Flyway flyway() {
            return Flyway.configure().dataSource(source).load();
        }

        UUID machine(String code) {
            UUID id = UUID.randomUUID();
            jdbc.update("INSERT INTO machines(id,code,name) VALUES (?,?,?)", id, code, code);
            return id;
        }

        UUID slot(UUID machine, String code) {
            UUID id = UUID.randomUUID();
            jdbc.update("INSERT INTO machine_slots(id,machine_id,slot_code,capacity) VALUES (?,?,?,6)", id, machine, code);
            return id;
        }

        @Override
        public void close() {
            container.stop();
        }
    }

    @Test
    void unambiguousCodesAreRenamedFailedCommandsGetALegacyReasonAndTheChecksHoldForNewRows() {
        try (var db = Database.atV13()) {
            UUID m1 = db.machine("LEGACY-1"), m2 = db.machine("LEGACY-2");
            UUID a1 = db.slot(m1, "A1"), b1 = db.slot(m1, " b1 "), keptA = db.slot(m2, "A"), keptB = db.slot(m2, "B");
            // A FAILED, a TIMEOUT and a SUCCESS command from before V14.
            UUID product = UUID.randomUUID(), batch = UUID.randomUUID();
            db.jdbc().update("INSERT INTO products(id,sku,name,price) VALUES (?,'LEGACY','Legacy',1)", product);
            db.jdbc().update("INSERT INTO product_batches(id,batch_code,product_id,manufactured_at,expires_at,quantity) VALUES (?,'LEGACY',?,now(),now()+interval '2 days',3)", batch, product);
            UUID failed = command(db, m1, a1, batch, "FAILED"), timedOut = command(db, m1, b1, batch, "TIMEOUT"), done = command(db, m2, keptA, batch, "SUCCESS");
            var history = db.jdbc().queryForObject("SELECT count(*) FROM inventory_transactions", Long.class);

            assertThat(db.flyway().migrate().migrationsExecuted).isEqualTo(1);
            assertThat(db.flyway().validateWithResult().validationSuccessful).isTrue();
            assertThat(db.jdbc().queryForObject("SELECT slot_code FROM machine_slots WHERE id=?", String.class, a1)).isEqualTo("A");
            assertThat(db.jdbc().queryForObject("SELECT slot_code FROM machine_slots WHERE id=?", String.class, b1)).isEqualTo("B");
            assertThat(db.jdbc().queryForObject("SELECT slot_code FROM machine_slots WHERE id=?", String.class, keptA)).isEqualTo("A");
            assertThat(db.jdbc().queryForObject("SELECT slot_code FROM machine_slots WHERE id=?", String.class, keptB)).isEqualTo("B");
            // Slots keep their ids, so inventory and dispense history still point at them.
            assertThat(db.jdbc().queryForObject("SELECT count(*) FROM inventory_transactions", Long.class)).isEqualTo(history);
            assertThat(db.jdbc().queryForObject("SELECT failure_reason FROM dispense_commands WHERE id=?", String.class, failed)).isEqualTo("LEGACY_UNKNOWN");
            assertThat(db.jdbc().queryForObject("SELECT failure_reason FROM dispense_commands WHERE id=?", String.class, timedOut)).isEqualTo("LEGACY_UNKNOWN");
            assertThat(db.jdbc().queryForObject("SELECT failure_reason FROM dispense_commands WHERE id=?", String.class, done)).isNull();

            UUID m3 = db.machine("NEW-1");
            for (String code : new String[]{"C", "A1", "a", ""}) {
                assertThatThrownBy(() -> db.slot(m3, code)).as(code).isInstanceOf(DataIntegrityViolationException.class);
            }
            db.slot(m3, "A");
            assertThatThrownBy(() -> db.jdbc().update("UPDATE dispense_commands SET status='FAILED' WHERE id=?", done))
                    .isInstanceOf(DataIntegrityViolationException.class);
            assertThatThrownBy(() -> db.jdbc().update("UPDATE dispense_commands SET failure_reason='RESULT_TIMEOUT' WHERE id=?", done))
                    .isInstanceOf(DataIntegrityViolationException.class);
            assertThatThrownBy(() -> db.jdbc().update("UPDATE dispense_commands SET failure_reason=' ' WHERE id=?", failed))
                    .isInstanceOf(DataIntegrityViolationException.class);
            db.jdbc().update("UPDATE dispense_commands SET failure_reason='NOT_DELIVERED' WHERE id=?", failed);
        }
    }

    @Test
    void ambiguousSlotCodesStopTheMigrationWithAClearMessageAndChangeNothing() {
        for (String[] codes : new String[][]{{"A1", "A2"}, {"A", "a1"}, {"C1"}, {"S1", "B"}}) {
            try (var db = Database.atV13()) {
                UUID machine = db.machine("AMBIGUOUS");
                for (String code : codes) db.slot(machine, code);
                var before = db.jdbc().queryForList("SELECT id, slot_code FROM machine_slots ORDER BY id");
                assertThatThrownBy(() -> db.flyway().migrate()).as(String.join(",", codes)).isInstanceOf(FlywayException.class)
                        .hasMessageContaining("V14 stopped").hasMessageContaining("AMBIGUOUS");
                assertThat(db.jdbc().queryForList("SELECT id, slot_code FROM machine_slots ORDER BY id")).isEqualTo(before);
                assertThat(db.jdbc().queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_name='dispense_commands' AND column_name='failure_reason'", Long.class)).isZero();
            }
        }
    }

    private static UUID command(Database db, UUID machine, UUID slot, UUID batch, String status) {
        UUID item = UUID.randomUUID(), order = UUID.randomUUID(), id = UUID.randomUUID();
        db.jdbc().update("INSERT INTO inventory_items(id,batch_id,slot_id,status,loaded_at) VALUES (?,?,?,'DISPENSE_FAILED',now())", item, batch, slot);
        db.jdbc().update("INSERT INTO orders(id,order_code,machine_id,status,subtotal,total_amount,paid_at) VALUES (?,?,?,'DISPENSE_FAILED',1,1,now())",
                order, "ORD-" + order.toString().substring(0, 8), machine);
        db.jdbc().update("""
                INSERT INTO dispense_commands(id,command_code,order_id,machine_id,slot_id,inventory_item_id,status,sent_at,completed_at)
                VALUES (?,?,?,?,?,?,?,now(),now())""", id, "D-" + id.toString().substring(0, 8), order, machine, slot, item, status);
        return id;
    }
}
