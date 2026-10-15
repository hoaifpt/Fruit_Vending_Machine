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
        assertThat(result.path("maxTotalQuantity").asInt()).isEqualTo(5);
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
    void reservedBowlsLeaveTheCatalogAndReleasedBowlsReturn() throws Exception {
        var stock = fixtures.stock(5, 5, admin.token(), staff.token());
        fixtures.load(stock, 4, staff.token());
        String key = issueKey(stock.machineId());
        assertThat(product(catalog(key), stock.productId()).path("availableQuantity").asInt()).isEqualTo(4);
        var order = kioskData("POST", "/api/v1/kiosk/orders", key, orderBody(line(stock.productId(), 3)), 201);
        assertThat(product(catalog(key), stock.productId()).path("availableQuantity").asInt()).isEqualTo(1);
        kioskData("POST", "/api/v1/kiosk/orders/" + order.path("id").asText() + "/cancel", key, null, 200);
        assertThat(product(catalog(key), stock.productId()).path("availableQuantity").asInt()).isEqualTo(4);
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
