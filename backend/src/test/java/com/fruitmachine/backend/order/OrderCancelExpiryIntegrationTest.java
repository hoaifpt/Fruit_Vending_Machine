package com.fruitmachine.backend.order;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class OrderCancelExpiryIntegrationTest extends AbstractOrderIntegrationTest {
    private record Shop(UUID machineId, UUID slotId, UUID productId, String key) {}

    private Shop shop(int bowls) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID slot = createSlot(machine, "A1", 20), product = createProduct("Cancel bowl", "15000");
        load(fixtures.batch(product, bowls, staff.token()), slot, bowls);
        return new Shop(machine, slot, product, issueKey(machine));
    }

    private JsonNode order(Shop shop, int quantity) throws Exception {
        return kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), quantity)), 201);
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    @Test
    void cancelReleasesBowlsAllocationsAndWritesReturnHistory() throws Exception {
        Shop shop = shop(4);
        var order = order(shop, 3);
        UUID id = UUID.fromString(order.path("id").asText());
        var cancelled = kioskData("POST", "/api/v1/kiosk/orders/" + id + "/cancel", shop.key(), null, 200);
        assertThat(cancelled.path("status").asText()).isEqualTo("CANCELLED");
        assertThat(cancelled.path("cancelledAt").isNull()).isFalse();
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, id)).isEqualTo("CANCELLED");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='AVAILABLE' AND reserved_at IS NULL", shop.slotId())).isEqualTo(4);
        var allocations = jdbc.queryForList("SELECT a.status, a.released_at FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=?", id);
        assertThat(allocations).hasSize(3).allSatisfy(row -> { assertThat(row.get("status")).isEqualTo("RELEASED"); assertThat(row.get("released_at")).isNotNull(); });
        var returns = jdbc.queryForList("SELECT * FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", id);
        assertThat(returns).hasSize(3).allSatisfy(row -> {
            assertThat(row.get("reason")).isEqualTo("ORDER_CANCELLED");
            assertThat(row.get("status_before")).isEqualTo("RESERVED");
            assertThat(row.get("status_after")).isEqualTo("AVAILABLE");
            assertThat(row.get("performed_by")).isNull();
            assertThat(row.get("machine_id")).isEqualTo(shop.machineId());
            assertThat(row.get("slot_id")).isEqualTo(shop.slotId());
        });
        // RESERVE history is append-only and kept.
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RESERVE'", id)).isEqualTo(3);
        // The released bowls are sellable again.
        kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), 4)), 201);
    }

    @Test
    void cancelIsIdempotentAndOtherMachinesCannotCancel() throws Exception {
        Shop shop = shop(2);
        UUID otherMachine = fixtures.machine(admin.token());
        String otherKey = issueKey(otherMachine);
        UUID id = UUID.fromString(order(shop, 2).path("id").asText());
        kioskJson("POST", "/api/v1/kiosk/orders/" + id + "/cancel", otherKey, null, 404);
        kioskJson("POST", "/api/v1/kiosk/orders/" + UUID.randomUUID() + "/cancel", shop.key(), null, 404);
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, id)).isEqualTo("PENDING_PAYMENT");
        var first = kioskData("POST", "/api/v1/kiosk/orders/" + id + "/cancel", shop.key(), null, 200);
        var second = kioskData("POST", "/api/v1/kiosk/orders/" + id + "/cancel", shop.key(), null, 200);
        assertThat(second.path("cancelledAt")).isEqualTo(first.path("cancelledAt"));
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", id)).isEqualTo(2);
        // A cancelled order frees the bowls for a new order.
        kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), 2)), 201);
    }

    @Test
    void ordersInOtherStatesCannotBeCancelled() throws Exception {
        Shop shop = shop(1);
        UUID id = UUID.fromString(order(shop, 1).path("id").asText());
        // Payment is out of scope; simulate a backend-confirmed state directly in the database.
        jdbc.update("UPDATE orders SET status='PAID', paid_at=now() WHERE id=?", id);
        var error = kioskJson("POST", "/api/v1/kiosk/orders/" + id + "/cancel", shop.key(), null, 409);
        assertThat(error.path("message").asText()).contains("PENDING_PAYMENT");
        assertThat(count("SELECT count(*) FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=? AND a.status='RESERVED'", id)).isEqualTo(1);
        assertThat(expiry.sweep()).isZero();
    }

    @Test
    void sweepExpiresOnlyDuePendingOrdersAndReleasesTheirBowls() throws Exception {
        Shop shop = shop(6);
        UUID due = UUID.fromString(order(shop, 2).path("id").asText());
        clock.advance(Duration.ofMinutes(3));
        UUID later = UUID.fromString(order(shop, 2).path("id").asText());
        UUID paid = UUID.fromString(order(shop, 1).path("id").asText());
        jdbc.update("UPDATE orders SET status='PAID', paid_at=now() WHERE id=?", paid);

        // Nothing is due yet: reads never write and the sweep ignores unexpired orders.
        assertThat(expiry.sweep()).isZero();
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, due)).isEqualTo("PENDING_PAYMENT");

        clock.advance(Duration.ofMinutes(3));
        var overdue = kioskData("GET", "/api/v1/kiosk/orders/" + due, shop.key(), null, 200);
        assertThat(overdue.path("status").asText()).isEqualTo("PENDING_PAYMENT");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, due)).isEqualTo("PENDING_PAYMENT");

        assertThat(expiry.sweep()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, due)).isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, later)).isEqualTo("PENDING_PAYMENT");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, paid)).isEqualTo("PAID");
        var returns = jdbc.queryForList("SELECT reason FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", due);
        assertThat(returns).hasSize(2).allSatisfy(row -> assertThat(row.get("reason")).isEqualTo("RESERVATION_EXPIRED"));
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='AVAILABLE'", shop.slotId())).isEqualTo(3);
        assertThat(expiry.sweep()).isZero();

        clock.advance(Duration.ofMinutes(10));
        assertThat(expiry.sweep()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, later)).isEqualTo("CANCELLED");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='AVAILABLE'", shop.slotId())).isEqualTo(5);
    }

    @Test
    void sweepContinuesWhenOneOrderFails() throws Exception {
        Shop shop = shop(5);
        UUID broken = UUID.fromString(order(shop, 1).path("id").asText());
        UUID healthyA = UUID.fromString(order(shop, 1).path("id").asText());
        UUID healthyB = UUID.fromString(order(shop, 1).path("id").asText());
        // Corrupt exactly one reservation: the bowl is no longer RESERVED, so releasing that order fails.
        jdbc.update("UPDATE inventory_items SET status='REMOVED', removed_at=now(), reserved_at=NULL WHERE id IN (SELECT a.inventory_item_id FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=?)", broken);
        // Make the broken order the first due one.
        jdbc.update("UPDATE orders SET expires_at = created_at + interval '1 second' WHERE id=?", broken);
        clock.advance(Duration.ofMinutes(10));
        assertThat(expiry.sweep()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, broken)).isEqualTo("PENDING_PAYMENT");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, healthyA)).isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, healthyB)).isEqualTo("CANCELLED");
        // The failed order rolled back completely.
        assertThat(count("SELECT count(*) FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=? AND a.status='RESERVED'", broken)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", broken)).isZero();
    }

    @Test
    void releasedBowlsReturnToTheCatalogAfterExpiry() throws Exception {
        Shop shop = shop(3);
        order(shop, 3);
        assertThat(kioskData("GET", "/api/v1/kiosk/catalog", shop.key(), null, 200).path("products")).isEmpty();
        clock.advance(Duration.ofMinutes(6));
        assertThat(expiry.sweep()).isEqualTo(1);
        var catalog = kioskData("GET", "/api/v1/kiosk/catalog", shop.key(), null, 200);
        assertThat(catalog.path("products")).hasSize(1);
        assertThat(catalog.path("products").get(0).path("availableQuantity").asInt()).isEqualTo(3);
    }
}
