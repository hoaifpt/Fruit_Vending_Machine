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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.assertThat;

class OrderCreationIntegrationTest extends AbstractOrderIntegrationTest {
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

    @Test
    void createsPendingOrderWithServerPricesReservedBowlsAllocationsAndReserveHistory() throws Exception {
        Shop shop = shop();
        UUID mix = stocked(shop, "Mixed bowl", "35000", 4), mango = stocked(shop, "Mango bowl", "22500.50", 3);
        Instant before = Instant.now();
        var order = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(mix, 2), line(mango, 1)), 201);
        Instant after = Instant.now();

        UUID orderId = UUID.fromString(order.path("id").asText());
        assertThat(order.path("status").asText()).isEqualTo("PENDING_PAYMENT");
        assertThat(order.path("machineId").asText()).isEqualTo(shop.machineId().toString());
        assertThat(order.path("orderCode").asText()).matches("ORD-\\d{8}-[0-9A-HJKMNP-TV-Z]{8}");
        assertThat(order.path("subtotal").decimalValue()).isEqualByComparingTo("92500.50");
        assertThat(order.path("totalAmount").decimalValue()).isEqualByComparingTo("92500.50");
        assertThat(order.path("cancelledAt").isNull()).isTrue();
        assertThat(order.path("items")).hasSize(2);
        for (var item : order.path("items")) {
            boolean isMix = item.path("productId").asText().equals(mix.toString());
            assertThat(item.path("quantity").asInt()).isEqualTo(isMix ? 2 : 1);
            assertThat(item.path("unitPrice").decimalValue()).isEqualByComparingTo(isMix ? "35000" : "22500.50");
            assertThat(item.path("totalPrice").decimalValue()).isEqualByComparingTo(isMix ? "70000" : "22500.50");
        }
        Instant created = Instant.parse(order.path("createdAt").asText()), expires = Instant.parse(order.path("expiresAt").asText());
        assertThat(expires).isAfter(created).isBetween(before.plus(Duration.ofMinutes(5)).minusMillis(1), after.plus(Duration.ofMinutes(5)).plusMillis(1));

        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, orderId)).isEqualTo("PENDING_PAYMENT");
        var bowls = jdbc.queryForList("""
                SELECT i.id, i.status, i.reserved_at, a.status AS allocation, h.type, h.performed_by, h.machine_id, h.slot_id,
                       h.status_before, h.status_after, h.reference_id, h.reason, i.slot_id AS item_slot
                FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id
                JOIN inventory_items i ON i.id=a.inventory_item_id
                JOIN inventory_transactions h ON h.inventory_item_id=i.id AND h.type='RESERVE'
                WHERE oi.order_id=?
                """, orderId);
        assertThat(bowls).hasSize(3).allSatisfy(row -> {
            assertThat(row.get("status")).isEqualTo("RESERVED");
            assertThat(row.get("reserved_at")).isNotNull();
            assertThat(row.get("allocation")).isEqualTo("RESERVED");
            assertThat(row.get("performed_by")).isNull();
            assertThat(row.get("machine_id")).isEqualTo(shop.machineId());
            assertThat(row.get("slot_id")).isEqualTo(shop.slotId()).isEqualTo(row.get("item_slot"));
            assertThat(row.get("status_before")).isEqualTo("AVAILABLE");
            assertThat(row.get("status_after")).isEqualTo("RESERVED");
            assertThat(row.get("reference_id")).isEqualTo(orderId);
            assertThat(row.get("reason")).isNull();
        });
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE status='RESERVED' AND slot_id=?", Long.class, shop.slotId())).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE status='AVAILABLE' AND slot_id=?", Long.class, shop.slotId())).isEqualTo(4);

        var read = kioskData("GET", "/api/v1/kiosk/orders/" + orderId, shop.key(), null, 200);
        assertThat(read.path("status").asText()).isEqualTo("PENDING_PAYMENT");
        assertThat(read.path("expiresAt")).isEqualTo(order.path("expiresAt"));
    }

    @Test
    void reservesEarliestExpiringBatchFirst() throws Exception {
        Shop shop = shop();
        UUID product = createProduct("FEFO bowl", "10000");
        UUID late = shortBatch(product, 3, 3 * 86400), early = shortBatch(product, 3, 86400), middle = shortBatch(product, 3, 2 * 86400);
        load(late, shop.slotId(), 2); load(early, shop.slotId(), 2); load(middle, shop.slotId(), 2);
        var order = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(product, 3)), 201);
        var reservedBatches = jdbc.queryForList("""
                SELECT i.batch_id, count(*) AS n FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id
                JOIN inventory_items i ON i.id=a.inventory_item_id WHERE oi.order_id=? GROUP BY i.batch_id
                """, UUID.fromString(order.path("id").asText()));
        assertThat(reservedBatches).hasSize(2);
        assertThat(reservedBatches).anySatisfy(row -> { assertThat(row.get("batch_id")).isEqualTo(early); assertThat(row.get("n")).isEqualTo(2L); });
        assertThat(reservedBatches).anySatisfy(row -> { assertThat(row.get("batch_id")).isEqualTo(middle); assertThat(row.get("n")).isEqualTo(1L); });
    }

    @Test
    void neverReservesABowlThatExpiresBeforeTheHoldDeadline() throws Exception {
        Shop shop = shop();
        UUID product = createProduct("Short hold bowl", "10000");
        load(shortBatch(product, 2, 120), shop.slotId(), 2);
        kioskJson("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(product, 1)), 409);
        load(shortBatch(product, 1, 3600), shop.slotId(), 1);
        kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(product, 1)), 201);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items i JOIN product_batches b ON b.id=i.batch_id WHERE b.product_id=? AND i.status='RESERVED' AND b.expires_at < now() + interval '5 minutes'", Long.class, product)).isZero();
    }

    @Test
    void insufficientQuantityFailsWholeOrderWithoutReservingAnything() throws Exception {
        Shop shop = shop();
        UUID plenty = stocked(shop, "Plenty bowl", "10000", 3), scarce = stocked(shop, "Scarce bowl", "20000", 1);
        long orders = jdbc.queryForObject("SELECT count(*) FROM orders WHERE machine_id=?", Long.class, shop.machineId());
        var error = kioskJson("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(plenty, 1), line(scarce, 2)), 409);
        assertThat(error.toString()).doesNotContain("inventory_items", "SQL", "Hibernate");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE machine_id=?", Long.class, shop.machineId())).isEqualTo(orders);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status<>'AVAILABLE'", Long.class, shop.slotId())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions WHERE machine_id=? AND type='RESERVE'", Long.class, shop.machineId())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_item_allocations a JOIN inventory_items i ON i.id=a.inventory_item_id WHERE i.slot_id=?", Long.class, shop.slotId())).isZero();
    }

    @Test
    void rejectsUnknownInactiveProductsAndMachinesThatAreNotActive() throws Exception {
        Shop shop = shop();
        UUID product = stocked(shop, "Rule bowl", "10000", 3);
        kioskJson("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(UUID.randomUUID(), 1)), 404);
        fixtures.api("PATCH", "/api/v1/products/" + product + "/status", Map.of("status", "INACTIVE"), admin.token(), 200);
        kioskJson("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(product, 1)), 409);
        fixtures.api("PATCH", "/api/v1/products/" + product + "/status", Map.of("status", "ACTIVE"), admin.token(), 200);
        for (String status : new String[]{"INACTIVE", "MAINTENANCE"}) {
            fixtures.api("PATCH", "/api/v1/machines/" + shop.machineId() + "/status", Map.of("status", status), admin.token(), 200);
            kioskJson("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(product, 1)), 409);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE machine_id=?", Long.class, shop.machineId())).isZero();
    }

    @Test
    void validatesTheRequestStrictly() throws Exception {
        Shop shop = shop();
        UUID a = stocked(shop, "Valid A", "10000", 9), b = stocked(shop, "Valid B", "10000", 9);
        String url = "/api/v1/kiosk/orders";
        kioskJson("POST", url, shop.key(), Map.of("items", List.of()), 400);
        kioskJson("POST", url, shop.key(), Map.of(), 400);
        kioskJson("POST", url, shop.key(), "{\"items\":null}", 400);
        kioskJson("POST", url, shop.key(), "not json", 400);
        kioskJson("POST", url, shop.key(), orderBody(line(a, 0)), 400);
        kioskJson("POST", url, shop.key(), orderBody(line(a, -1)), 400);
        kioskJson("POST", url, shop.key(), "{\"items\":[{\"productId\":\"" + a + "\",\"quantity\":1.5}]}", 400);
        kioskJson("POST", url, shop.key(), "{\"items\":[{\"productId\":\"" + a + "\",\"quantity\":\"2\"}]}", 400);
        kioskJson("POST", url, shop.key(), "{\"items\":[{\"productId\":\"" + a + "\",\"quantity\":1e0}]}", 400);
        kioskJson("POST", url, shop.key(), "{\"items\":[{\"productId\":\"" + a + "\"}]}", 400);
        kioskJson("POST", url, shop.key(), "{\"items\":[{\"quantity\":1}]}", 400);
        kioskJson("POST", url, shop.key(), orderBody(line(a, 1), line(a, 1)), 400);
        kioskJson("POST", url, shop.key(), orderBody(line(a, 3), line(b, 3)), 400);
        kioskJson("POST", url, shop.key(), orderBody(line(a, 6)), 400);
        kioskJson("POST", url, shop.key(), orderBody(line(a, 99999999999L)), 400);
        var many = new java.util.ArrayList<Map<String, Object>>();
        for (int i = 0; i < 11; i++) many.add(line(UUID.randomUUID(), 1));
        kioskJson("POST", url, shop.key(), Map.of("items", many), 400);
        for (String extra : new String[]{"\"price\":1", "\"machineId\":\"" + UUID.randomUUID() + "\"", "\"status\":\"PAID\"",
                "\"orderCode\":\"ORD-X\"", "\"totalAmount\":1", "\"slotId\":\"" + UUID.randomUUID() + "\"", "\"inventoryItemId\":\"" + UUID.randomUUID() + "\""}) {
            kioskJson("POST", url, shop.key(), "{\"items\":[{\"productId\":\"" + a + "\",\"quantity\":1}]," + extra + "}", 400);
            kioskJson("POST", url, shop.key(), "{\"items\":[{\"productId\":\"" + a + "\",\"quantity\":1," + extra + "}]}", 400);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE machine_id=?", Long.class, shop.machineId())).isZero();
        kioskData("POST", url, shop.key(), orderBody(line(a, 3), line(b, 2)), 201);
    }

    @Test
    void laterProductPriceChangeDoesNotAlterExistingOrders() throws Exception {
        Shop shop = shop();
        UUID product = stocked(shop, "Price bowl", "10000", 3);
        var order = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(product, 2)), 201);
        fixtures.api("PUT", "/api/v1/products/" + product, Map.of("name", "Price bowl", "price", new BigDecimal("99999.99")), admin.token(), 200);
        var read = kioskData("GET", "/api/v1/kiosk/orders/" + order.path("id").asText(), shop.key(), null, 200);
        assertThat(read.path("items").get(0).path("unitPrice").decimalValue()).isEqualByComparingTo("10000");
        assertThat(read.path("totalAmount").decimalValue()).isEqualByComparingTo("20000");
        var next = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(product, 1)), 201);
        assertThat(next.path("totalAmount").decimalValue()).isEqualByComparingTo("99999.99");
    }

    @ParameterizedTest
    @ValueSource(ints = {8})
    void orderCodesAreUniqueAndKioskCannotReadOrOrderForAnotherMachine(int count) throws Exception {
        Shop shop = shop(), other = shop();
        UUID product = stocked(shop, "Code bowl", "1000", count);
        Set<String> codes = new HashSet<>();
        UUID first = null;
        for (int i = 0; i < count; i++) {
            var order = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(product, 1)), 201);
            assertThat(codes.add(order.path("orderCode").asText())).isTrue();
            if (first == null) first = UUID.fromString(order.path("id").asText());
        }
        kioskJson("GET", "/api/v1/kiosk/orders/" + first, other.key(), null, 404);
        kioskJson("GET", "/api/v1/kiosk/orders/" + UUID.randomUUID(), shop.key(), null, 404);
        // The other kiosk has no stock of this product on its own machine.
        kioskJson("POST", "/api/v1/kiosk/orders", other.key(), orderBody(line(product, 1)), 409);
    }
}
