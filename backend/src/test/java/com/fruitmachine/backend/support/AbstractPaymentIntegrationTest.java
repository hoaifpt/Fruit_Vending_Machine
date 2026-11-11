package com.fruitmachine.backend.support;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

/**
 * Payment fixtures: the controllable TESTPAY provider is the active gateway, attempts live 2 minutes (shorter than the
 * 5 minute reservation), at most 3 attempts per order and the provider timeout is 1 second.
 */
@Import({TestClockConfig.class, TestPaymentGatewayConfig.class})
@TestPropertySource(properties = {"app.payment.provider=TESTPAY", "app.payment.attempt-ttl=PT2M", "app.payment.max-attempts-per-order=3",
        "app.payment.provider-timeout=PT1S"})
public abstract class AbstractPaymentIntegrationTest extends AbstractOrderIntegrationTest {
    @Autowired protected ControllableGateway gateway;

    public record Shop(UUID machineId, UUID slotId, UUID productId, String key) {}

    public record PlacedOrder(Shop shop, UUID orderId, String orderCode) {
        public String payments() { return "/api/v1/kiosk/orders/" + orderId + "/payments"; }
        public String order() { return "/api/v1/kiosk/orders/" + orderId; }
    }

    @BeforeEach
    void resetGateway() {
        gateway.reset();
    }

    protected Shop shop(int bowls) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID slot = createSlot(machine, "P1", 30), product = createProduct("Payment bowl", "35000");
        load(fixtures.batch(product, bowls, staff.token()), slot, bowls);
        return new Shop(machine, slot, product, issueKey(machine));
    }

    /** Several slots of one bowl each, so that many orders can be PENDING at once (one RESERVED bowl per slot). */
    protected Shop shopWithSlots(int count) throws Exception {
        UUID machine = fixtures.machine(admin.token()), product = createProduct("Payment bowl", "35000");
        UUID batch = fixtures.batch(product, count, staff.token()), first = null;
        for (int n = 0; n < count; n++) {
            UUID slot = createSlot(machine, "P" + (n + 1), 30);
            load(batch, slot, 1);
            if (first == null) first = slot;
        }
        return new Shop(machine, first, product, issueKey(machine));
    }

    protected PlacedOrder placeOrder(Shop shop) throws Exception {
        JsonNode order = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(shop.productId()), 201);
        return new PlacedOrder(shop, UUID.fromString(order.path("id").asText()), order.path("orderCode").asText());
    }

    /** One bowl from a fresh machine whose single slot holds a few bowls (only the head is reservable). */
    protected PlacedOrder placeOrder() throws Exception {
        return placeOrder(shop(3));
    }

    protected JsonNode pay(PlacedOrder order, int expectedStatus) throws Exception {
        return kioskJson("POST", order.payments(), order.shop().key(), null, expectedStatus);
    }

    protected long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    protected java.time.Instant instant(String sql, Object... args) {
        return jdbc.queryForObject(sql, java.time.OffsetDateTime.class, args).toInstant();
    }

    protected String orderStatus(UUID orderId) {
        return jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, orderId);
    }
}
