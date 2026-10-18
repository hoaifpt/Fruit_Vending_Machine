package com.fruitmachine.backend.support;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Order-management fixtures: kiosk keys, kiosk HTTP calls and an advanceable clock; sweep disabled by profile. */
@Import(TestClockConfig.class)
public abstract class AbstractOrderIntegrationTest extends AbstractCoreIntegrationTest {
    @Autowired protected OffsetClock clock;
    @Autowired protected com.fruitmachine.backend.order.service.OrderExpiryService expiry;

    /** The sweep is global; earlier tests of this class leave PENDING orders that must not be swept here. */
    @BeforeEach
    void detachLeftoverPendingOrdersFromTheSweep() {
        jdbc.update("UPDATE orders SET expires_at = NULL WHERE status = 'PENDING_PAYMENT'");
    }

    @AfterEach
    void resetClock() {
        clock.reset();
    }

    /** Issues a kiosk credential through the real ADMIN endpoint and returns the plaintext key. */
    protected String issueKey(UUID machineId) throws Exception {
        return fixtures.api("POST", "/api/v1/machines/" + machineId + "/kiosk-credentials", null, admin.token(), 201).path("apiKey").asText();
    }

    protected MvcResult kioskCall(String method, String path, String key, Object body) throws Exception {
        var req = request(HttpMethod.valueOf(method), path).contentType("application/json");
        if (key != null) req.header("X-Kiosk-Key", key);
        if (body != null) req.content(body instanceof String text ? text : json.writeValueAsString(body));
        return mvc.perform(req).andReturn();
    }

    protected JsonNode kioskJson(String method, String path, String key, Object body, int expected) throws Exception {
        MvcResult result = kioskCall(method, path, key, body);
        assertThat(result.getResponse().getStatus()).as("%s %s -> %s", method, path, result.getResponse().getContentAsString()).isEqualTo(expected);
        return json.readTree(result.getResponse().getContentAsString());
    }

    protected JsonNode kioskData(String method, String path, String key, Object body, int expected) throws Exception {
        return kioskJson(method, path, key, body, expected).path("data");
    }

    /** The only accepted kiosk order shape since issue #35: one product, one bowl. */
    protected static Map<String, Object> orderBody(UUID productId) {
        return Map.of("productId", productId);
    }

    /**
     * Inserts a CANCELLED multi-line order the way #27 used to create it (before the one-bowl rule of #35), with RELEASED
     * allocations to bowls of the given slot. Lines are {productId, quantity}; prices are the current product prices.
     */
    protected UUID insertHistoricalOrder(UUID machineId, UUID slotId, Object[]... lines) {
        UUID orderId = UUID.randomUUID();
        java.math.BigDecimal total = java.math.BigDecimal.ZERO;
        for (Object[] line : lines) {
            total = total.add(jdbc.queryForObject("SELECT price FROM products WHERE id=?", java.math.BigDecimal.class, line[0])
                    .multiply(java.math.BigDecimal.valueOf((Integer) line[1])));
        }
        jdbc.update("""
                INSERT INTO orders (id, order_code, machine_id, status, subtotal, total_amount, created_at, cancelled_at)
                VALUES (?, ?, ?, 'CANCELLED', ?, ?, now(), now())
                """, orderId, "ORD-HIST-" + orderId.toString().substring(0, 8).toUpperCase(), machineId, total, total);
        for (Object[] line : lines) {
            UUID lineId = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total_price)
                    SELECT ?, ?, p.id, ?, p.price, p.price * ? FROM products p WHERE p.id = ?
                    """, lineId, orderId, line[1], line[1], line[0]);
            jdbc.update("""
                    INSERT INTO order_item_allocations (order_item_id, inventory_item_id, status, released_at)
                    SELECT ?, i.id, 'RELEASED', now() FROM inventory_items i JOIN product_batches b ON b.id = i.batch_id
                    WHERE i.slot_id = ? AND b.product_id = ? ORDER BY i.loaded_at, i.id LIMIT ?
                    """, lineId, slotId, line[0], line[1]);
        }
        return orderId;
    }

    /** A batch whose expiry is close to now, to exercise the hold-deadline rule. */
    protected UUID shortBatch(UUID productId, int quantity, long expiresInSeconds) throws Exception {
        Instant now = Instant.now();
        return TestDataFactory.id(fixtures.api("POST", "/api/v1/product-batches", Map.of("batchCode", "SHORT-" + UUID.randomUUID(),
                "productId", productId, "manufacturedAt", now.minusSeconds(3600).toString(),
                "expiresAt", now.plusSeconds(expiresInSeconds).toString(), "quantity", quantity), staff.token(), 201));
    }

    protected UUID createProduct(String name, String price) throws Exception {
        return TestDataFactory.id(fixtures.api("POST", "/api/v1/products", Map.of("sku", "OM-" + UUID.randomUUID().toString().substring(0, 12),
                "name", name, "price", new java.math.BigDecimal(price)), admin.token(), 201));
    }

    protected UUID createSlot(UUID machineId, String code, int capacity) throws Exception {
        return TestDataFactory.id(fixtures.api("POST", "/api/v1/machines/" + machineId + "/slots", Map.of("slotCode", code, "capacity", capacity), admin.token(), 201));
    }

    protected void load(UUID batchId, UUID slotId, int quantity) throws Exception {
        fixtures.api("POST", "/api/v1/inventory/load", TestDataFactory.loadBody(batchId, slotId, quantity), staff.token(), 201);
    }
}
