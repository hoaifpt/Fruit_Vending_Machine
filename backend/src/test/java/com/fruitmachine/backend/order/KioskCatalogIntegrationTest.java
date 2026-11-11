package com.fruitmachine.backend.order;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import com.fruitmachine.backend.support.TestDataFactory;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class KioskCatalogIntegrationTest extends AbstractOrderIntegrationTest {
    private JsonNode catalog(String key) throws Exception {
        return kioskData("GET", "/api/v1/kiosk/catalog", key, null, 200);
    }

    private JsonNode product(JsonNode catalog, UUID productId) {
        for (JsonNode p : catalog.path("products")) if (p.path("productId").asText().equals(productId.toString())) return p;
        return null;
    }

    private UUID head(UUID slotId) {
        return jdbc.queryForObject("""
                SELECT id FROM inventory_items WHERE slot_id=? AND status IN ('AVAILABLE','RESERVED','EXPIRED','DISPENSE_FAILED')
                ORDER BY loaded_at, id LIMIT 1
                """, UUID.class, slotId);
    }

    @Test
    void listsOnlySellableProductsOfTheOwnMachineWithoutInternalIdentifiers() throws Exception {
        UUID machine = fixtures.machine(admin.token()), otherMachine = fixtures.machine(admin.token());
        UUID sellable = createProduct("Catalog sellable", "35000"), shortLived = createProduct("Catalog short", "20000"),
                inactiveProduct = createProduct("Catalog inactive product", "10000"), inactiveSlotProduct = createProduct("Catalog inactive slot", "11000"),
                removedProduct = createProduct("Catalog removed", "12000"), otherOnly = createProduct("Catalog other machine", "13000"),
                emptyProduct = createProduct("Catalog no stock", "14000");
        UUID slot = createSlot(machine, "A1", 20), inactiveSlot = createSlot(machine, "A2", 5), otherSlot = createSlot(otherMachine, "A1", 10);
        UUID sellableBatch = fixtures.batch(sellable, 10, staff.token());
        UUID shortBatch = shortBatch(shortLived, 5, 120);
        UUID inactiveBatch = fixtures.batch(inactiveProduct, 5, staff.token());
        UUID inactiveSlotBatch = fixtures.batch(inactiveSlotProduct, 5, staff.token());
        UUID removedBatch = fixtures.batch(removedProduct, 5, staff.token());
        UUID otherBatch = fixtures.batch(otherOnly, 5, staff.token());
        // Column A1 bottom to top: 3 sellable bowls, then short-lived, inactive and removed bowls behind them.
        load(sellableBatch, slot, 3); load(shortBatch, slot, 2); load(inactiveBatch, slot, 1);
        load(inactiveSlotBatch, inactiveSlot, 2); load(otherBatch, otherSlot, 2);
        load(fixtures.batch(sellable, 5, staff.token()), otherSlot, 4);
        var removed = fixtures.api("POST", "/api/v1/inventory/load", TestDataFactory.loadBody(removedBatch, slot, 1), staff.token(), 201);
        UUID removedItem = TestDataFactory.id(removed.path("items").get(0));
        fixtures.api("POST", "/api/v1/inventory/" + removedItem + "/remove", Map.of("reason", "Catalog removal test"), staff.token(), 200);
        fixtures.api("PATCH", "/api/v1/products/" + inactiveProduct + "/status", Map.of("status", "INACTIVE"), admin.token(), 200);
        fixtures.api("PATCH", "/api/v1/machines/" + machine + "/slots/" + inactiveSlot + "/status", Map.of("status", "INACTIVE"), admin.token(), 200);
        // Stockroom item with no slot (legacy off-machine row) is never sellable.
        jdbc.update("INSERT INTO inventory_items(batch_id, status, loaded_at) VALUES (?, 'AVAILABLE', now())", sellableBatch);

        String key = issueKey(machine);
        var result = catalog(key);
        assertThat(result.path("acceptingOrders").asBoolean()).isTrue();
        assertThat(result.path("machineId").asText()).isEqualTo(machine.toString());
        // Removed in #35: one purchase is always one bowl.
        assertThat(result.has("maxTotalQuantity")).isFalse();
        assertThat(result.fieldNames()).toIterable().containsExactlyInAnyOrder("machineId", "machineCode", "acceptingOrders", "products");
        var only = product(result, sellable);
        assertThat(only).isNotNull();
        assertThat(only.path("availableQuantity").asInt()).isEqualTo(3);
        assertThat(only.path("price").decimalValue()).isEqualByComparingTo("35000");
        assertThat(only.path("sku").asText()).startsWith("OM-");
        assertThat(result.path("products")).hasSize(1);
        for (UUID excluded : new UUID[]{shortLived, inactiveProduct, inactiveSlotProduct, removedProduct, otherOnly, emptyProduct})
            assertThat(product(result, excluded)).as("excluded product %s", excluded).isNull();
        String body = result.toString();
        assertThat(body).doesNotContain(slot.toString(), inactiveSlot.toString(), sellableBatch.toString(), "slotCode", "batchCode", "inventoryItemId", "\"A1\"");
        assertThat(only.fieldNames()).toIterable().containsExactlyInAnyOrder("productId", "sku", "name", "description", "price", "imageUrl", "availableQuantity");
    }

    @Test
    void reservedHeadBlocksItsColumnAndReleasingItRestoresTheProduct() throws Exception {
        var stock = fixtures.stock(5, 5, admin.token(), staff.token());
        fixtures.load(stock, 4, staff.token());
        String key = issueKey(stock.machineId());
        assertThat(product(catalog(key), stock.productId()).path("availableQuantity").asInt()).isEqualTo(4);
        var order = kioskData("POST", "/api/v1/kiosk/orders", key, orderBody(stock.productId()), 201);
        // The only column's head is RESERVED: the three bowls behind it cannot drop, so the product is not listed.
        assertThat(product(catalog(key), stock.productId())).isNull();
        kioskData("POST", "/api/v1/kiosk/orders/" + order.path("id").asText() + "/cancel", key, null, 200);
        assertThat(product(catalog(key), stock.productId()).path("availableQuantity").asInt()).isEqualTo(4);
    }

    @Test
    void blockedHeadsHideTheProductAndOnlySellableColumnsAreCounted() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID expiredStatus = createProduct("Head EXPIRED status", "10000"), expiredBatch = createProduct("Head batch expired", "10000"),
                failed = createProduct("Head DISPENSE_FAILED", "10000"), soon = createProduct("Head expires during hold", "10000"),
                counted = createProduct("Counted product", "10000"), otherHead = createProduct("Other product head", "10000");
        UUID a1 = createSlot(machine, "A1", 10), a2 = createSlot(machine, "A2", 10), a3 = createSlot(machine, "A3", 10), a4 = createSlot(machine, "A4", 10),
                b1 = createSlot(machine, "B1", 10), b2 = createSlot(machine, "B2", 10), b3 = createSlot(machine, "B3", 10);
        // A1: head set to EXPIRED status; fresh bowls of the same product behind it.
        load(fixtures.batch(expiredStatus, 4, staff.token()), a1, 4);
        jdbc.update("UPDATE inventory_items SET status='EXPIRED' WHERE id=?", head(a1));
        // A2: head AVAILABLE but its batch is already expired; fresh bowls behind it.
        UUID stale = shortBatch(expiredBatch, 1, 3600);
        load(stale, a2, 1);
        load(fixtures.batch(expiredBatch, 3, staff.token()), a2, 3);
        jdbc.update("UPDATE product_batches SET expires_at = now() - interval '1 minute' WHERE id=?", stale);
        // A3: head DISPENSE_FAILED.
        load(fixtures.batch(failed, 3, staff.token()), a3, 3);
        jdbc.update("UPDATE inventory_items SET status='DISPENSE_FAILED' WHERE id=?", head(a3));
        // A4: head expires in 2 minutes, before the 5 minute hold ends.
        load(shortBatch(soon, 1, 120), a4, 1);
        load(fixtures.batch(soon, 2, staff.token()), a4, 2);
        // Counted product: B1 sellable (2 bowls), B2 blocked by an EXPIRED head (3 fresh behind it), B3 with another product on top.
        UUID countedBatch = fixtures.batch(counted, 10, staff.token());
        load(countedBatch, b1, 2);
        load(countedBatch, b2, 4);
        jdbc.update("UPDATE inventory_items SET status='EXPIRED' WHERE id=?", head(b2));
        load(fixtures.batch(otherHead, 1, staff.token()), b3, 1);
        load(countedBatch, b3, 2);

        var result = catalog(issueKey(machine));
        for (UUID blocked : new UUID[]{expiredStatus, expiredBatch, failed, soon})
            assertThat(product(result, blocked)).as("blocked product %s", blocked).isNull();
        assertThat(product(result, counted).path("availableQuantity").asInt()).as("only B1 counts").isEqualTo(2);
        assertThat(product(result, otherHead).path("availableQuantity").asInt()).isEqualTo(1);
        assertThat(result.path("products")).hasSize(2);

        // Optional section 9: the slot summary shows staff which head blocks a column; existing fields are unchanged.
        String summary = "/api/v1/machines/" + machine + "/slots/%s/inventory/summary";
        var expiredHead = fixtures.api("GET", summary.formatted(a1), null, staff.token(), 200);
        assertThat(expiredHead.path("headStatus").asText()).isEqualTo("EXPIRED");
        assertThat(expiredHead.path("headExpired").asBoolean()).isTrue();
        assertThat(expiredHead.path("occupiedCount").asLong()).isEqualTo(4);
        var staleHead = fixtures.api("GET", summary.formatted(a2), null, staff.token(), 200);
        assertThat(staleHead.path("headStatus").asText()).isEqualTo("AVAILABLE");
        assertThat(staleHead.path("headExpired").asBoolean()).isTrue();
        assertThat(fixtures.api("GET", summary.formatted(a3), null, staff.token(), 200).path("headStatus").asText()).isEqualTo("DISPENSE_FAILED");
        var sellableHead = fixtures.api("GET", summary.formatted(b1), null, staff.token(), 200);
        assertThat(sellableHead.path("headStatus").asText()).isEqualTo("AVAILABLE");
        assertThat(sellableHead.path("headExpired").asBoolean()).isFalse();
        UUID empty = createSlot(machine, "E1", 10);
        var emptySlot = fixtures.api("GET", summary.formatted(empty), null, staff.token(), 200);
        assertThat(emptySlot.path("headStatus").isNull()).isTrue();
        assertThat(emptySlot.path("headExpired").asBoolean()).isFalse();
    }

    @Test
    void machineThatIsNotActiveIsNotAcceptingOrders() throws Exception {
        var stock = fixtures.stock(3, 3, admin.token(), staff.token());
        fixtures.load(stock, 2, staff.token());
        String key = issueKey(stock.machineId());
        for (String status : new String[]{"INACTIVE", "MAINTENANCE"}) {
            fixtures.api("PATCH", "/api/v1/machines/" + stock.machineId() + "/status", Map.of("status", status), admin.token(), 200);
            var result = catalog(key);
            assertThat(result.path("acceptingOrders").asBoolean()).isFalse();
            assertThat(result.path("products")).isEmpty();
        }
        fixtures.api("PATCH", "/api/v1/machines/" + stock.machineId() + "/status", Map.of("status", "ACTIVE"), admin.token(), 200);
        assertThat(catalog(key).path("products")).hasSize(1);
    }
}
