package com.fruitmachine.backend.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Real HTTP-controller fixtures with unique roots; no test relies on another test's rows. */
public final class TestDataFactory {
    public record Account(UUID id, String token) {}
    public record Stock(UUID productId, UUID batchId, UUID machineId, UUID slotId) {
        public String slotInventory() {
            return "/api/v1/machines/" + machineId + "/slots/" + slotId + "/inventory";
        }
    }
    private final MockMvc mvc;
    private final ObjectMapper json;
    private final JdbcTemplate jdbc;

    public TestDataFactory(MockMvc mvc, ObjectMapper json, JdbcTemplate jdbc) {
        this.mvc = mvc; this.json = json; this.jdbc = jdbc;
    }

    public JsonNode response(String method, String path, Object body, String token, int expected) throws Exception {
        var req = request(HttpMethod.valueOf(method), path).contentType("application/json");
        if (token != null) req.header("Authorization", "Bearer " + token);
        if (body != null) req.content(json.writeValueAsString(body));
        String response = mvc.perform(req).andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
        return json.readTree(response);
    }

    public JsonNode api(String method, String path, Object body, String token, int expected) throws Exception {
        return response(method, path, body, token, expected).path("data");
    }

    public Account login(String email, String password) throws Exception {
        var result = api("POST", "/api/v1/auth/login", Map.of("email", email, "password", password), null, 200);
        return new Account(jdbc.queryForObject("SELECT id FROM users WHERE email=?", UUID.class, email), result.path("accessToken").asText());
    }

    public Account staff(String adminToken, String password) throws Exception {
        String email = UUID.randomUUID() + "@example.invalid";
        api("POST", "/api/v1/users", Map.of("email", email, "password", password, "fullName", "Core test staff"), adminToken, 201);
        return login(email, password);
    }

    public UUID product(String token) throws Exception {
        return id(api("POST", "/api/v1/products", Map.of("sku", "TEST-" + UUID.randomUUID(), "name", "Core fruit box", "price", 35000), token, 201));
    }

    public UUID machine(String token) throws Exception {
        UUID id = id(api("POST", "/api/v1/machines", Map.of("code", "TEST-" + UUID.randomUUID(), "name", "Core machine",
                "location", "Isolated test", "minTemperature", 2, "maxTemperature", 8, "minHumidity", 40, "maxHumidity", 80), token, 201));
        api("PATCH", "/api/v1/machines/" + id + "/status", Map.of("status", "ACTIVE"), token, 200);
        return id;
    }

    public UUID slot(UUID machineId, int capacity, String token) throws Exception {
        return id(api("POST", "/api/v1/machines/" + machineId + "/slots", Map.of("slotCode", "A1", "capacity", capacity), token, 201));
    }

    public UUID batch(UUID productId, int quantity, String token) throws Exception {
        Instant now = Instant.now();
        return id(api("POST", "/api/v1/product-batches", Map.of("batchCode", "TEST-" + UUID.randomUUID(), "productId", productId,
                "manufacturedAt", now.minusSeconds(86400).toString(), "expiresAt", now.plusSeconds(172800).toString(), "quantity", quantity), token, 201));
    }

    public Stock stock(int quantity, int capacity, String adminToken, String staffToken) throws Exception {
        UUID product = product(adminToken), machine = machine(adminToken), slot = slot(machine, capacity, adminToken);
        return new Stock(product, batch(product, quantity, staffToken), machine, slot);
    }

    public JsonNode load(Stock stock, int quantity, String token) throws Exception {
        return api("POST", "/api/v1/inventory/load", loadBody(stock.batchId(), stock.slotId(), quantity), token, 201);
    }

    public static Map<String, Object> loadBody(UUID batchId, UUID slotId, int quantity) {
        return Map.of("batchId", batchId, "slotId", slotId, "quantity", quantity);
    }
    public static UUID id(JsonNode node) { return UUID.fromString(node.path("id").asText()); }
}
