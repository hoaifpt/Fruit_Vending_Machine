package com.fruitmachine.backend.order;

import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class OrderCreationIntegrationTest extends AbstractOrderIntegrationTest {
    private static final String URL = "/api/v1/kiosk/orders";
    private static final String PRESENT = "('AVAILABLE','RESERVED','EXPIRED','DISPENSE_FAILED')";

    private record Shop(UUID machineId, UUID slotId, String key) {}

    private Shop shop() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        return new Shop(machine, createSlot(machine, "A1", 30), issueKey(machine));
    }

    private UUID stocked(Shop shop, String name, String price, int bowls) throws Exception {
        UUID product = createProduct(name, price);
        load(fixtures.batch(product, bowls, staff.token()), shop.slotId(), bowls);
        return product;
    }

    private UUID orderId(com.fasterxml.jackson.databind.JsonNode order) {
        return UUID.fromString(order.path("id").asText());
    }

    private UUID reservedBowl(UUID orderId) {
        return jdbc.queryForObject("SELECT a.inventory_item_id FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=?",
                UUID.class, orderId);
    }

    private UUID slotOf(UUID itemId) {
        return jdbc.queryForObject("SELECT slot_id FROM inventory_items WHERE id=?", UUID.class, itemId);
    }

    private List<UUID> column(UUID slotId) {
        return jdbc.queryForList("SELECT id FROM inventory_items WHERE slot_id=? AND status IN " + PRESENT + " ORDER BY loaded_at, id", UUID.class, slotId);
    }

    private void setHead(UUID slotId, String status) {
        jdbc.update("UPDATE inventory_items SET status=? WHERE id=?", status, column(slotId).get(0));
    }

    private long reservedIn(UUID slotId) {
        return jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", Long.class, slotId);
    }

    // ---- 11. Request contract ----

    @Test
    void createsPendingOrderWithOneBowlServerPriceAllocationAndReserveHistory() throws Exception {
        Shop shop = shop();
        UUID mango = stocked(shop, "Mango bowl", "22500.50", 3);
        Instant before = Instant.now();
        var order = kioskData("POST", URL, shop.key(), orderBody(mango), 201);
        Instant after = Instant.now();

        UUID id = orderId(order);
        assertThat(order.path("status").asText()).isEqualTo("PENDING_PAYMENT");
        assertThat(order.path("machineId").asText()).isEqualTo(shop.machineId().toString());
        assertThat(order.path("orderCode").asText()).matches("ORD-\\d{8}-[0-9A-HJKMNP-TV-Z]{8}");
        assertThat(order.path("cancelledAt").isNull()).isTrue();
        assertThat(order.path("items")).hasSize(1);
        var item = order.path("items").get(0);
        assertThat(item.path("productId").asText()).isEqualTo(mango.toString());
        assertThat(item.path("quantity").asInt()).isEqualTo(1);
        assertThat(item.path("unitPrice").decimalValue()).isEqualByComparingTo("22500.50");
        assertThat(item.path("totalPrice").decimalValue()).isEqualByComparingTo("22500.50");
        assertThat(order.path("subtotal").decimalValue()).isEqualByComparingTo("22500.50");
        assertThat(order.path("totalAmount").decimalValue()).isEqualByComparingTo("22500.50");
        Instant created = Instant.parse(order.path("createdAt").asText()), expires = Instant.parse(order.path("expiresAt").asText());
        assertThat(expires).isAfter(created).isBetween(before.plus(Duration.ofMinutes(5)).minusMillis(1), after.plus(Duration.ofMinutes(5)).plusMillis(1));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_items WHERE order_id=?", Long.class, id)).isEqualTo(1);
        var bowls = jdbc.queryForList("""
                SELECT i.id, i.status, i.reserved_at, a.status AS allocation, h.type, h.performed_by, h.machine_id, h.slot_id,
                       h.status_before, h.status_after, h.reference_id, h.reason, i.slot_id AS item_slot
                FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id
                JOIN inventory_items i ON i.id=a.inventory_item_id
                JOIN inventory_transactions h ON h.inventory_item_id=i.id AND h.type='RESERVE'
                WHERE oi.order_id=?
                """, id);
        assertThat(bowls).hasSize(1).allSatisfy(row -> {
            assertThat(row.get("id")).isEqualTo(column(shop.slotId()).get(0));
            assertThat(row.get("status")).isEqualTo("RESERVED");
            assertThat(row.get("reserved_at")).isNotNull();
            assertThat(row.get("allocation")).isEqualTo("RESERVED");
            assertThat(row.get("performed_by")).isNull();
            assertThat(row.get("machine_id")).isEqualTo(shop.machineId());
            assertThat(row.get("slot_id")).isEqualTo(shop.slotId()).isEqualTo(row.get("item_slot"));
            assertThat(row.get("status_before")).isEqualTo("AVAILABLE");
            assertThat(row.get("status_after")).isEqualTo("RESERVED");
            assertThat(row.get("reference_id")).isEqualTo(id);
            assertThat(row.get("reason")).isNull();
        });
        assertThat(reservedIn(shop.slotId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE status='AVAILABLE' AND slot_id=?", Long.class, shop.slotId())).isEqualTo(2);

        var read = kioskData("GET", URL + "/" + id, shop.key(), null, 200);
        assertThat(read.path("status").asText()).isEqualTo("PENDING_PAYMENT");
        assertThat(read.path("items")).hasSize(1);
        assertThat(read.path("expiresAt")).isEqualTo(order.path("expiresAt"));
    }

    @Test
    void validatesTheRequestStrictly() throws Exception {
        Shop shop = shop();
        UUID a = stocked(shop, "Valid A", "10000", 3);
        kioskJson("POST", URL, shop.key(), Map.of(), 400);
        kioskJson("POST", URL, shop.key(), "{\"productId\":null}", 400);
        kioskJson("POST", URL, shop.key(), "{\"productId\":\"not-a-uuid\"}", 400);
        kioskJson("POST", URL, shop.key(), "{\"productId\":42}", 400);
        kioskJson("POST", URL, shop.key(), "{\"productId\":[\"" + a + "\"]}", 400);
        kioskJson("POST", URL, shop.key(), "not json", 400);
        // The #27 shape is gone.
        kioskJson("POST", URL, shop.key(), Map.of("items", List.of(Map.of("productId", a, "quantity", 1))), 400);
        kioskJson("POST", URL, shop.key(), Map.of("items", List.of()), 400);
        for (String extra : new String[]{"\"quantity\":1", "\"quantity\":2", "\"price\":1", "\"machineId\":\"" + UUID.randomUUID() + "\"", "\"status\":\"PAID\"",
                "\"orderCode\":\"ORD-X\"", "\"totalAmount\":1", "\"slotId\":\"" + UUID.randomUUID() + "\"", "\"inventoryItemId\":\"" + UUID.randomUUID() + "\"",
                "\"items\":[]"}) {
            kioskJson("POST", URL, shop.key(), "{\"productId\":\"" + a + "\"," + extra + "}", 400);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE machine_id=?", Long.class, shop.machineId())).isZero();
        assertThat(reservedIn(shop.slotId())).isZero();
        kioskData("POST", URL, shop.key(), Map.of("productId", a), 201);
    }

    @Test
    void rejectsUnknownInactiveProductsAndMachinesThatAreNotActive() throws Exception {
        Shop shop = shop();
        UUID product = stocked(shop, "Rule bowl", "10000", 3);
        kioskJson("POST", URL, shop.key(), orderBody(UUID.randomUUID()), 404);
        fixtures.api("PATCH", "/api/v1/products/" + product + "/status", Map.of("status", "INACTIVE"), admin.token(), 200);
        kioskJson("POST", URL, shop.key(), orderBody(product), 409);
        fixtures.api("PATCH", "/api/v1/products/" + product + "/status", Map.of("status", "ACTIVE"), admin.token(), 200);
        for (String status : new String[]{"INACTIVE", "MAINTENANCE"}) {
            fixtures.api("PATCH", "/api/v1/machines/" + shop.machineId() + "/status", Map.of("status", status), admin.token(), 200);
            kioskJson("POST", URL, shop.key(), orderBody(product), 409);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE machine_id=?", Long.class, shop.machineId())).isZero();
    }

    // ---- 12. Head selection ----

    @Test
    void reservesTheBottomBowlEvenWhenAFresherBowlSitsHigherInTheColumn() throws Exception {
        Shop shop = shop();
        UUID product = createProduct("Column bowl", "10000");
        // Loaded t1 < t2 < t3; the bowl loaded last is the freshest (latest expiry) and also the earliest-expiring one is on top.
        UUID first = shortBatch(product, 1, 2 * 86400), second = shortBatch(product, 1, 3 * 86400), third = shortBatch(product, 1, 86400);
        load(first, shop.slotId(), 1); load(second, shop.slotId(), 1); load(third, shop.slotId(), 1);
        List<UUID> column = column(shop.slotId());
        var order = kioskData("POST", URL, shop.key(), orderBody(product), 201);
        UUID reserved = reservedBowl(orderId(order));
        assertThat(reserved).isEqualTo(column.get(0));
        assertThat(jdbc.queryForObject("SELECT batch_id FROM inventory_items WHERE id=?", UUID.class, reserved)).isEqualTo(first);
        // Neither the fresher bowl (t2) nor the earliest-expiring bowl deeper in the column (t3) was taken.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE batch_id IN (?, ?) AND status='AVAILABLE'", Long.class, second, third)).isEqualTo(2);
    }

    @Test
    void reservedHeadMakesTheSlotBusyUntilAnotherSlotOrA409() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID a1 = createSlot(machine, "A1", 10), a2 = createSlot(machine, "A2", 10);
        String key = issueKey(machine);
        UUID product = createProduct("Busy bowl", "10000"), batch = fixtures.batch(product, 6, staff.token());
        load(batch, a1, 3);
        load(batch, a2, 3);
        UUID firstSlot = slotOf(reservedBowl(orderId(kioskData("POST", URL, key, orderBody(product), 201))));
        UUID secondSlot = slotOf(reservedBowl(orderId(kioskData("POST", URL, key, orderBody(product), 201))));
        assertThat(Set.of(firstSlot, secondSlot)).containsExactlyInAnyOrder(a1, a2);
        // Both heads are RESERVED; four AVAILABLE fresh bowls remain but none of them can drop next.
        var error = kioskJson("POST", URL, key, orderBody(product), 409);
        assertThat(error.path("message").asText()).isEqualTo("Requested product is not available on this machine");
        assertThat(error.toString()).doesNotContain("inventory_items", "SQL", "Hibernate");
        assertThat(reservedIn(a1)).isEqualTo(1);
        assertThat(reservedIn(a2)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE machine_id=?", Long.class, machine)).isEqualTo(2);
    }

    @Test
    void blockedHeadsBlockTheirSlot() throws Exception {
        for (String blocker : new String[]{"EXPIRED", "DISPENSE_FAILED", "BATCH_EXPIRED", "EXPIRES_DURING_HOLD", "SLOT_INACTIVE", "SLOT_ERROR"}) {
            Shop shop = shop();
            UUID product = createProduct("Blocked " + blocker, "10000");
            if (blocker.equals("BATCH_EXPIRED") || blocker.equals("EXPIRES_DURING_HOLD")) {
                UUID head = shortBatch(product, 1, blocker.equals("BATCH_EXPIRED") ? 3600 : 120);
                load(head, shop.slotId(), 1);
                if (blocker.equals("BATCH_EXPIRED")) jdbc.update("UPDATE product_batches SET expires_at = now() - interval '1 minute' WHERE id=?", head);
            }
            load(fixtures.batch(product, 3, staff.token()), shop.slotId(), 3);
            switch (blocker) {
                case "EXPIRED", "DISPENSE_FAILED" -> setHead(shop.slotId(), blocker);
                case "SLOT_INACTIVE" -> fixtures.api("PATCH", "/api/v1/machines/" + shop.machineId() + "/slots/" + shop.slotId() + "/status", Map.of("status", "INACTIVE"), admin.token(), 200);
                case "SLOT_ERROR" -> jdbc.update("UPDATE machine_slots SET status='ERROR' WHERE id=?", shop.slotId());
                default -> { }
            }
            kioskJson("POST", URL, shop.key(), orderBody(product), 409);
            assertThat(reservedIn(shop.slotId())).as(blocker).isZero();
            // A second, healthy column of the same product on the same machine is used instead.
            UUID healthy = createSlot(shop.machineId(), "B1", 10);
            load(fixtures.batch(product, 1, staff.token()), healthy, 1);
            assertThat(slotOf(reservedBowl(orderId(kioskData("POST", URL, shop.key(), orderBody(product), 201))))).as(blocker).isEqualTo(healthy);
            assertThat(reservedIn(shop.slotId())).as(blocker).isZero();
        }
    }

    @Test
    void headOfAnotherProductBlocksTheColumnForThisProduct() throws Exception {
        Shop shop = shop();
        UUID top = stocked(shop, "Head product", "10000", 1), behind = stocked(shop, "Behind product", "10000", 2);
        kioskJson("POST", URL, shop.key(), orderBody(behind), 409);
        kioskData("POST", URL, shop.key(), orderBody(top), 201);
    }

    @Test
    void choosesTheSlotWhoseHeadExpiresFirstThenLoadedAtThenSlotCode() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String key = issueKey(machine);
        UUID product = createProduct("FEFO heads", "10000");
        UUID late = shortBatch(product, 6, 3 * 86400), early = shortBatch(product, 6, 86400);
        UUID c1 = createSlot(machine, "C1", 10), b1 = createSlot(machine, "B1", 10), a1 = createSlot(machine, "A1", 10);
        // C1 head expires latest; A1 head expires earliest but sits on top of nothing special; B1 deeper bowls expire earliest.
        load(late, c1, 1);
        load(late, b1, 1); load(early, b1, 2);
        load(early, a1, 1);
        assertThat(slotOf(reservedBowl(orderId(kioskData("POST", URL, key, orderBody(product), 201))))).isEqualTo(a1);
        // A1 is busy now; B1 and C1 heads share the late batch: the earlier loaded head (C1) wins before slot code.
        assertThat(slotOf(reservedBowl(orderId(kioskData("POST", URL, key, orderBody(product), 201))))).isEqualTo(c1);
        assertThat(slotOf(reservedBowl(orderId(kioskData("POST", URL, key, orderBody(product), 201))))).isEqualTo(b1);

        // Same expiry and same loaded_at: slot code decides.
        UUID other = fixtures.machine(admin.token());
        String otherKey = issueKey(other);
        UUID z9 = createSlot(other, "Z9", 10), d4 = createSlot(other, "D4", 10);
        load(early, z9, 1); load(early, d4, 1);
        jdbc.update("UPDATE inventory_items SET loaded_at = '2026-01-01T00:00:00Z' WHERE slot_id IN (?, ?)", z9, d4);
        assertThat(slotOf(reservedBowl(orderId(kioskData("POST", URL, otherKey, orderBody(product), 201))))).isEqualTo(d4);
    }

    @Test
    void soldAndRemovedBowlsAreNotPartOfTheColumn() throws Exception {
        Shop shop = shop();
        UUID product = stocked(shop, "Ghost bowl", "10000", 3);
        List<UUID> column = column(shop.slotId());
        // Bottom bowl dropped earlier (SOLD), the next one was removed by staff: the third bowl is the head now.
        jdbc.update("UPDATE inventory_items SET status='SOLD', sold_at=loaded_at + interval '1 second' WHERE id=?", column.get(0));
        jdbc.update("UPDATE inventory_items SET status='REMOVED', removed_at=now() WHERE id=?", column.get(1));
        assertThat(reservedBowl(orderId(kioskData("POST", URL, shop.key(), orderBody(product), 201)))).isEqualTo(column.get(2));
    }

    @Test
    void bowlsOfTheSameLoadAreReservedInIdOrder() throws Exception {
        Shop shop = shop();
        UUID product = stocked(shop, "Same load", "10000", 4);
        assertThat(jdbc.queryForObject("SELECT count(DISTINCT loaded_at) FROM inventory_items WHERE slot_id=?", Long.class, shop.slotId())).isEqualTo(1);
        var ids = jdbc.queryForList("SELECT id FROM inventory_items WHERE slot_id=? ORDER BY id", UUID.class, shop.slotId());
        for (int round = 0; round < 2; round++) {
            var order = kioskData("POST", URL, shop.key(), orderBody(product), 201);
            assertThat(reservedBowl(orderId(order))).isEqualTo(ids.get(0));
            kioskData("POST", URL + "/" + orderId(order) + "/cancel", shop.key(), null, 200);
        }
    }

    // ---- Regression ----

    @Test
    void laterProductPriceChangeDoesNotAlterExistingOrders() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID a1 = createSlot(machine, "A1", 10), a2 = createSlot(machine, "A2", 10);
        String key = issueKey(machine);
        UUID product = createProduct("Price bowl", "10000"), batch = fixtures.batch(product, 2, staff.token());
        load(batch, a1, 1); load(batch, a2, 1);
        var order = kioskData("POST", URL, key, orderBody(product), 201);
        fixtures.api("PUT", "/api/v1/products/" + product, Map.of("name", "Price bowl", "price", new BigDecimal("99999.99")), admin.token(), 200);
        var read = kioskData("GET", URL + "/" + order.path("id").asText(), key, null, 200);
        assertThat(read.path("items").get(0).path("unitPrice").decimalValue()).isEqualByComparingTo("10000");
        assertThat(read.path("totalAmount").decimalValue()).isEqualByComparingTo("10000");
        var next = kioskData("POST", URL, key, orderBody(product), 201);
        assertThat(next.path("totalAmount").decimalValue()).isEqualByComparingTo("99999.99");
    }

    @Test
    void orderCodesAreUniqueAndKioskCannotReadOrOrderForAnotherMachine() throws Exception {
        Shop shop = shop(), other = shop();
        UUID product = stocked(shop, "Code bowl", "1000", 2);
        Set<String> codes = new HashSet<>();
        UUID first = null;
        for (int i = 0; i < 8; i++) {
            var order = kioskData("POST", URL, shop.key(), orderBody(product), 201);
            assertThat(codes.add(order.path("orderCode").asText())).isTrue();
            if (first == null) first = orderId(order);
            else kioskData("POST", URL + "/" + orderId(order) + "/cancel", shop.key(), null, 200);
            if (i == 0) kioskData("POST", URL + "/" + first + "/cancel", shop.key(), null, 200);
        }
        kioskJson("GET", URL + "/" + first, other.key(), null, 404);
        kioskJson("GET", URL + "/" + UUID.randomUUID(), shop.key(), null, 404);
        // The other kiosk has no stock of this product on its own machine.
        kioskJson("POST", URL, other.key(), orderBody(product), 409);
    }
}
