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

    protected static Map<String, Object> line(UUID productId, Object quantity) {
        return Map.of("productId", productId, "quantity", quantity);
    }

    protected static Map<String, Object> orderBody(Map<String, Object>... lines) {
        return Map.of("items", java.util.List.of(lines));
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
