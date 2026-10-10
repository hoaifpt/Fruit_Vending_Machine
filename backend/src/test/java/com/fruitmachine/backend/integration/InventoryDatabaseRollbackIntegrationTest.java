package com.fruitmachine.backend.integration;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import com.fruitmachine.backend.support.TestDataFactory;
import java.util.UUID;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import static org.assertj.core.api.Assertions.assertThat;

class InventoryDatabaseRollbackIntegrationTest extends AbstractCoreIntegrationTest {
    @ParameterizedTest
    @CsvSource({"23514,409", "XX000,500"})
    void databaseFailureAfterFirstHistoryInsertRollsBackWholeLoad(String sqlState, int httpStatus) throws Exception {
        var stock = fixtures.stock(8, 6, admin.token(), staff.token());
        String name = "test_fail_history_" + UUID.randomUUID().toString().replace("-", "");
        // Test-only trigger on this disposable database, scoped to this test's unique batch.
        // It fails the second history insert after the items and first event were written.
        jdbc.execute("CREATE FUNCTION " + name + "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF (SELECT batch_id FROM inventory_items WHERE id=NEW.inventory_item_id)='" + stock.batchId() + "'::uuid "
                + "AND EXISTS (SELECT 1 FROM inventory_transactions h JOIN inventory_items i ON i.id=h.inventory_item_id WHERE i.batch_id='" + stock.batchId() + "'::uuid) "
                + "THEN RAISE EXCEPTION 'Test-only SQL failure: internal details must never reach the client' USING ERRCODE='" + sqlState + "'; END IF; RETURN NEW; END $$");
        try {
            jdbc.execute("CREATE TRIGGER " + name + " BEFORE INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION " + name + "()");
            var error = fixtures.response("POST", "/api/v1/inventory/load",
                    TestDataFactory.loadBody(stock.batchId(), stock.slotId(), 4), staff.token(), httpStatus);
            assertThat(error.path("status").asInt()).isEqualTo(httpStatus);
            assertThat(error.path("path").asText()).isEqualTo("/api/v1/inventory/load");
            assertThat(error.path("message").asText()).isNotBlank();
            assertThat(error.toString()).doesNotContain("Test-only SQL", "CREATE", "SELECT", name, sqlState,
                    "org.hibernate", "org.postgresql", "password", "stackTrace");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE batch_id=?", Long.class, stock.batchId())).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions WHERE machine_id=?", Long.class, stock.machineId())).isZero();
            var summary = fixtures.api("GET", stock.slotInventory()+"/summary", null, admin.token(), 200);
            assertThat(summary.path("occupiedCount").asInt()).isZero();
            assertThat(summary.path("remainingCapacity").asInt()).isEqualTo(6);
        } finally {
            jdbc.execute("DROP FUNCTION " + name + "() CASCADE");
        }
        // Recovery commits normally after the injected fault is removed.
        fixtures.load(stock, 4, staff.token());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE batch_id=?", Long.class, stock.batchId())).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions WHERE machine_id=?", Long.class, stock.machineId())).isEqualTo(4);
    }
}
