package com.fruitmachine.backend.order;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/** The real scheduled trigger, enabled with a short reservation TTL and sweep interval. */
@TestPropertySource(properties = {"app.order.expiry-sweep.enabled=true", "app.order.expiry-sweep.interval=PT0.5S",
        "app.order.reservation-ttl=PT2S"})
class OrderExpirySchedulerIntegrationTest extends AbstractCoreIntegrationTest {
    @Test
    void scheduledSweepReleasesAnExpiredReservationWithoutAnyManualCall() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID slot = fixtures.slot(machine, 5, admin.token());
        UUID product = fixtures.product(admin.token());
        fixtures.api("POST", "/api/v1/inventory/load", Map.of("batchId", fixtures.batch(product, 2, staff.token()), "slotId", slot, "quantity", 2), staff.token(), 201);
        String key = fixtures.api("POST", "/api/v1/machines/" + machine + "/kiosk-credentials", null, admin.token(), 201).path("apiKey").asText();
        var request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/v1/kiosk/orders")
                .header("X-Kiosk-Key", key).contentType("application/json")
                .content(json.writeValueAsString(Map.of("productId", product)));
        var order = json.readTree(mvc.perform(request).andReturn().getResponse().getContentAsString()).path("data");
        UUID orderId = UUID.fromString(order.path("id").asText());
        assertThat(order.path("status").asText()).isEqualTo("PENDING_PAYMENT");

        await().atMost(Duration.ofSeconds(30)).pollInterval(Duration.ofMillis(250)).untilAsserted(() ->
                assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, orderId)).isEqualTo("CANCELLED"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN' AND reason='RESERVATION_EXPIRED'", Long.class, orderId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='AVAILABLE'", Long.class, slot)).isEqualTo(2);
    }
}
