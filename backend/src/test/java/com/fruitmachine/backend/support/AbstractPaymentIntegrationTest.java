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

    protected PlacedOrder placeOrder(Shop shop, int quantity) throws Exception {
        JsonNode order = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), quantity)), 201);
        return new PlacedOrder(shop, UUID.fromString(order.path("id").asText()), order.path("orderCode").asText());
    }

    protected PlacedOrder placeOrder(int quantity) throws Exception {
        return placeOrder(shop(quantity + 2), quantity);
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
