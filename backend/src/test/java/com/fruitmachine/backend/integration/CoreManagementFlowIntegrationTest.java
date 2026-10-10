package com.fruitmachine.backend.integration;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import com.fruitmachine.backend.support.TestDataFactory;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.assertThat;

class CoreManagementFlowIntegrationTest extends AbstractCoreIntegrationTest {
    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void authenticatedManagementFlowPersistsLinkedItemsHistoryAndRemoval(boolean useAdmin) throws Exception {
        var actor = useAdmin ? admin : staff;
        var stock = fixtures.stock(8, 6, admin.token(), staff.token());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE batch_id=?", Long.class, stock.batchId())).isZero();
        assertThat(jdbc.queryForObject("SELECT created_by FROM product_batches WHERE id=?", UUID.class, stock.batchId())).isEqualTo(staff.id());

        var loaded = fixtures.load(stock, 3, actor.token());
        assertThat(loaded.path("items")).hasSize(3);
        UUID operation = UUID.fromString(loaded.path("operationId").asText());
        var records = jdbc.queryForList("""
                SELECT i.id, i.status, i.batch_id, i.slot_id, h.type, h.performed_by, h.status_after,
                       h.machine_id, h.reference_id FROM inventory_items i
                JOIN inventory_transactions h ON h.inventory_item_id=i.id WHERE i.batch_id=?
                """, stock.batchId());
        assertThat(records).hasSize(3).allSatisfy(row -> {
            assertThat(row.get("status")).isEqualTo("AVAILABLE");
            assertThat(row.get("batch_id")).isEqualTo(stock.batchId());
            assertThat(row.get("slot_id")).isEqualTo(stock.slotId());
            assertThat(row.get("machine_id")).isEqualTo(stock.machineId());
            assertThat(row.get("performed_by")).isEqualTo(actor.id());
            assertThat(row.get("type")).isEqualTo("LOAD");
            assertThat(row.get("status_after")).isEqualTo("AVAILABLE");
            assertThat(row.get("reference_id")).isEqualTo(operation);
        });
        var summary = fixtures.api("GET", stock.slotInventory()+"/summary", null, staff.token(), 200);
        assertThat(summary.path("occupiedCount").asInt()).isEqualTo(3);
        assertThat(summary.path("sellableCount").asInt()).isEqualTo(3);
        assertThat(summary.path("remainingCapacity").asInt()).isEqualTo(3);
        for (String filter : List.of("machineId="+stock.machineId(), "slotId="+stock.slotId(), "batchId="+stock.batchId())) {
            var page = fixtures.api("GET", "/api/v1/inventory?"+filter+"&size=2", null, actor.token(), 200);
            assertThat(page.path("totalElements").asInt()).isEqualTo(3);
            assertThat(page.path("content")).hasSize(2);
        }
        UUID item = TestDataFactory.id(loaded.path("items").get(0));
        fixtures.api("POST", "/api/v1/inventory/"+item+"/remove", Map.of("reason", "Confirmed physical removal"), actor.token(), 200);
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, item)).isEqualTo("REMOVED");
        assertThat(jdbc.queryForObject("SELECT slot_id FROM inventory_items WHERE id=?", UUID.class, item)).isEqualTo(stock.slotId());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=?", Long.class, item)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT quantity FROM product_batches WHERE id=?", Integer.class, stock.batchId())).isEqualTo(8);
        var removedSummary = fixtures.api("GET", stock.slotInventory()+"/summary", null, admin.token(), 200);
        assertThat(removedSummary.path("occupiedCount").asInt()).isEqualTo(2);
        assertThat(removedSummary.path("remainingCapacity").asInt()).isEqualTo(4);
        var history = fixtures.api("GET", "/api/v1/inventory/transactions?inventoryItemId="+item+"&type=REMOVE", null, staff.token(), 200);
        assertThat(history.path("content").get(0).path("performedBy").asText()).isEqualTo(actor.id().toString());
        assertThat(history.path("content").get(0).path("reason").asText()).isEqualTo("Confirmed physical removal");
    }

    @Test
    void deactivationAndElapsedExpiryAffectSellabilityWithoutDeletingTraceability() throws Exception {
        var stock = fixtures.stock(4, 4, admin.token(), staff.token());
        fixtures.load(stock, 2, staff.token());
        fixtures.api("PATCH", "/api/v1/products/"+stock.productId()+"/status", Map.of("status", "INACTIVE"), admin.token(), 200);
        var summary = fixtures.api("GET", stock.slotInventory()+"/summary", null, staff.token(), 200);
        assertThat(summary.path("availableCount").asInt()).isEqualTo(2);
        assertThat(summary.path("sellableCount").asInt()).isZero();
        fixtures.api("GET", "/api/v1/product-batches/"+stock.batchId(), null, staff.token(), 200);
        fixtures.response("POST", "/api/v1/inventory/load", TestDataFactory.loadBody(stock.batchId(), stock.slotId(), 1), staff.token(), 409);
        fixtures.api("PATCH", "/api/v1/products/"+stock.productId()+"/status", Map.of("status", "ACTIVE"), admin.token(), 200);
        jdbc.update("UPDATE product_batches SET expires_at=CURRENT_TIMESTAMP WHERE id=?", stock.batchId());
        summary = fixtures.api("GET", stock.slotInventory()+"/summary", null, staff.token(), 200);
        assertThat(summary.path("occupiedCount").asInt()).isEqualTo(2);
        assertThat(summary.path("expiredCount").asInt()).isEqualTo(2);
        assertThat(summary.path("sellableCount").asInt()).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE batch_id=? AND status='AVAILABLE'", Long.class, stock.batchId())).isEqualTo(2);
    }

    @Test
    void existingRoleMatrixAndCommonErrorsAreEnforcedThroughControllers() throws Exception {
        var stock = fixtures.stock(4, 4, admin.token(), staff.token());
        for (String path : List.of("/api/v1/products", "/api/v1/machines", "/api/v1/machines/"+stock.machineId()+"/slots",
                "/api/v1/product-batches", "/api/v1/inventory", "/api/v1/inventory/transactions")) {
            fixtures.api("GET", path, null, admin.token(), 200);
            fixtures.api("GET", path, null, staff.token(), 200);
            var missing = fixtures.response("GET", path, null, null, 401);
            assertThat(missing.path("path").asText()).isEqualTo(path);
            assertThat(missing.path("timestamp").asText()).isNotBlank();
        }
        fixtures.api("GET", "/api/v1/users", null, admin.token(), 200);
        for (String path : List.of("/api/v1/users", "/api/v1/products", "/api/v1/machines", "/api/v1/machines/"+stock.machineId()+"/slots")) {
            var error = fixtures.response("POST", path, Map.of(), staff.token(), 403);
            assertThat(error.path("status").asInt()).isEqualTo(403);
            assertThat(error.path("error").asText()).isEqualTo("Forbidden");
        }
        fixtures.response("GET", "/api/v1/users", null, staff.token(), 403);
        fixtures.response("GET", "/api/v1/inventory", null, "invalid.jwt", 401);
        fixtures.response("POST", "/api/v1/inventory/load", TestDataFactory.loadBody(stock.batchId(), stock.slotId(), 0), staff.token(), 400);
        var missing = fixtures.response("GET", "/api/v1/inventory/"+UUID.randomUUID(), null, staff.token(), 404);
        assertThat(missing.toString()).doesNotContain("passwordHash", "org.springframework", "SELECT", "stackTrace");
        String hash = jdbc.queryForObject("SELECT password_hash FROM users WHERE id=?", String.class, staff.id());
        assertThat(hash).startsWith("$2").isNotEqualTo(PASSWORD);
        var user = fixtures.api("GET", "/api/v1/users/"+staff.id(), null, admin.token(), 200);
        assertThat(user.toString()).doesNotContain(hash, PASSWORD, "passwordHash");
    }
}
