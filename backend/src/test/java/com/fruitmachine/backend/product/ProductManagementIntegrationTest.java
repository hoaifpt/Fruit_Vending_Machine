package com.fruitmachine.backend.product;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.product.dto.*;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.repository.ProductRepository;
import com.fruitmachine.backend.product.service.ProductService;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.math.BigDecimal;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.config.import=", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true",
        "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.fruitmachine.backend.product.ProductManagementIntegrationTest$ProductSqlCapture"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class ProductManagementIntegrationTest {
    public static class ProductSqlCapture implements org.hibernate.resource.jdbc.spi.StatementInspector {
        static final List<String> QUERIES = new CopyOnWriteArrayList<>();
        public String inspect(String sql) {
            if (sql.contains("from products")) QUERIES.add(sql);
            return sql;
        }
    }
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String PASSWORD = "Test-only-product-passphrase!";
    static final String KEY = newKey();
    static String newKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-product@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;
    @MockitoSpyBean ProductRepository products;
    @Autowired ProductService service;
    String adminToken;
    String staffToken;
    UUID adminId;
    Product mango;

    @BeforeEach
    void setup() throws Exception {
        // Only this container's isolated fixtures; no real database or environment import.
        for (String table : List.of("payments", "order_items", "orders", "inventory_items", "product_batches", "products", "machines", "user_roles", "users"))
            jdbc.update("DELETE FROM " + table);
        adminToken = accountAndLogin("ADMIN");
        staffToken = accountAndLogin("STAFF");
        mango = product("MANGO-BOX-001", "Mango Fruit Box", ProductStatus.ACTIVE, "35000.15");
    }
    String accountAndLogin(String role) throws Exception {
        var user = new User();
        user.setEmail(UUID.randomUUID() + "@example.invalid");
        user.setFullName("Isolated product tester");
        user.setPasswordHash(encoder.encode(PASSWORD));
        users.saveAndFlush(user);
        jdbc.update("INSERT INTO user_roles(user_id,role_id) SELECT ?, id FROM roles WHERE name=?", user.getId(), role);
        if (role.equals("ADMIN")) adminId = user.getId();
        String body = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(mapper.writeValueAsString(Map.of("email", user.getEmail(), "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(body).at("/data/accessToken").asText();
    }
    Product product(String sku, String name, ProductStatus status, String price) {
        var product = new Product();
        product.setSku(sku);
        product.setName(name);
        product.setPrice(new BigDecimal(price));
        product.setStatus(status);
        return products.saveAndFlush(product);
    }
    MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + adminToken);
    }
    String body(String sku) throws Exception {
        return mapper.writeValueAsString(Map.of("sku", sku, "name", " Mango Fruit Box ", "description", "Fresh mango",
                "price", new BigDecimal("35000.15"), "imageUrl", "https://example.com/products/mango.jpg"));
    }
    ObjectNode updateBody() throws Exception {
        var body = (ObjectNode) mapper.readTree(body("ignored"));
        body.remove("sku");
        return body;
    }

    @Test
    void adminCreatesActiveNormalizedCatalogAndPersistsExactMoneyAndSafeDto() throws Exception {
        var response = mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(body(" guava-box-001 ")))
                .andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.sku").value("GUAVA-BOX-001")).andExpect(jsonPath("$.data.name").value("Mango Fruit Box"))
                .andExpect(jsonPath("$.data.status").value("ACTIVE")).andExpect(jsonPath("$.data.price").value(35000.15))
                .andExpect(jsonPath("$.data.description").value("Fresh mango"))
                .andExpect(jsonPath("$.data.imageUrl").value("https://example.com/products/mango.jpg"))
                .andExpect(jsonPath("$.data.createdAt").exists()).andExpect(jsonPath("$.data.updatedAt").exists())
                .andExpect(jsonPath("$.data.batches").doesNotExist()).andExpect(jsonPath("$.data.quantity").doesNotExist())
                .andReturn().getResponse();
        String id = mapper.readTree(response.getContentAsString()).at("/data/id").asText();
        assertThat(response.getHeader("Location")).isEqualTo("/api/v1/products/" + id);
        Product saved = products.findById(UUID.fromString(id)).orElseThrow();
        assertThat(saved.getPrice()).isEqualByComparingTo("35000.15");
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isAfterOrEqualTo(saved.getCreatedAt());
    }

    @Test
    void normalizedDuplicateSkuReturnsSafeConflict() throws Exception {
        mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(body(" mango-box-001 ")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("SKU is already in use"));
        assertThat(products.count()).isEqualTo(1);
    }

    @Test
    void databaseUniqueConstraintGuardsConcurrentCreate() throws Exception {
        doReturn(false).when(products).existsBySku("RACE-SKU");
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var jobs = java.util.stream.IntStream.range(0, 2).mapToObj(i -> executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(body("race-sku")))
                        .andReturn().getResponse();
            })).toList();
            var responses = List.of(jobs.get(0).get(20, TimeUnit.SECONDS), jobs.get(1).get(20, TimeUnit.SECONDS));
            assertThat(responses).extracting(r -> r.getStatus()).containsExactlyInAnyOrder(201, 409);
            assertThat(responses.stream().filter(r -> r.getStatus() == 409).findFirst().orElseThrow().getContentAsString())
                    .contains("Request conflicts with existing data").doesNotContain("duplicate key", "Hibernate", "SQL");
        }
        assertThat(products.count()).isEqualTo(2);
    }

    @ParameterizedTest
    @ValueSource(strings = {"sku", "name"})
    void blankAndMissingRequiredStringsReturn400(String field) throws Exception {
        var input = (ObjectNode) mapper.readTree(body("NEW"));
        input.put(field, " ");
        mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(input.toString()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors." + field).exists());
        input.remove(field);
        mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(input.toString())).andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-10000", "0.001", "35000.123", "10000000000", "9999999999.999"})
    void invalidPricesAreRejectedOnCreateAndUpdateWithoutRounding(String price) throws Exception {
        var input = (ObjectNode) mapper.readTree(body("NEW"));
        input.put("price", new BigDecimal(price));
        mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(input.toString())).andExpect(status().isBadRequest());
        input.remove("sku");
        mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json").content(input.toString()))
                .andExpect(status().isBadRequest());
        assertThat(products.count()).isEqualTo(1);
        assertThat(products.findById(mango.getId()).orElseThrow().getPrice()).isEqualByComparingTo("35000.15");
    }

    @ParameterizedTest
    @ValueSource(strings = {"0.01", "9999999999.99", "25000", "35000.15"})
    void validMoneyBoundaryValuesPersistExactly(String price) throws Exception {
        var input = (ObjectNode) mapper.readTree(body("NEW"));
        input.put("price", new BigDecimal(price));
        var response = mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(input.toString()))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        var id = UUID.fromString(mapper.readTree(response).at("/data/id").asText());
        assertThat(products.findById(id).orElseThrow().getPrice()).isEqualByComparingTo(price);
    }

    @Test
    void nullOrMissingPriceAndOversizedColumnsAre400() throws Exception {
        for (String field : List.of("sku", "name", "imageUrl")) {
            var input = (ObjectNode) mapper.readTree(body("NEW"));
            input.put(field, "A".repeat(field.equals("sku") ? 65 : field.equals("name") ? 201 : 2049));
            mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(input.toString())).andExpect(status().isBadRequest());
            if (!field.equals("sku")) {
                input.remove("sku");
                mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json").content(input.toString()))
                        .andExpect(status().isBadRequest());
            }
        }
        for (boolean missing : List.of(true, false)) {
            var input = (ObjectNode) mapper.readTree(body("NEW"));
            if (missing) input.remove("price"); else input.putNull("price");
            mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(input.toString())).andExpect(status().isBadRequest());
            input.remove("sku");
            mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json").content(input.toString()))
                    .andExpect(status().isBadRequest());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"status", "id", "createdAt", "updatedAt", "quantity", "stock", "slot", "batchCode", "expirationDate"})
    void createRejectsStatusPersistenceAndUnrelatedDomainFields(String field) throws Exception {
        var input = (ObjectNode) mapper.readTree(body("NEW"));
        input.put(field, "forbidden");
        mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(input.toString())).andExpect(status().isBadRequest());
        assertThat(products.count()).isEqualTo(1);
    }

    @Test
    void adminAndStaffReadAndListBothStatusesWithDatabasePaginationFiltersSearchSort() throws Exception {
        ProductSqlCapture.QUERIES.clear();
        product("GUAVA-BOX-001", "Guava Fruit Box", ProductStatus.INACTIVE, "25000");
        product("MIXED-001", "Mixed Mango Bowl", ProductStatus.ACTIVE, "45000");
        for (String token : List.of(adminToken, staffToken)) {
            mvc.perform(get("/api/v1/products/" + mango.getId()).header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.sku").value("MANGO-BOX-001"));
            var first = mvc.perform(get("/api/v1/products").header("Authorization", "Bearer " + token).param("size", "2").param("sort", "name,asc"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.page").value(0)).andExpect(jsonPath("$.data.size").value(2))
                    .andExpect(jsonPath("$.data.totalElements").value(3)).andExpect(jsonPath("$.data.totalPages").value(2))
                    .andExpect(jsonPath("$.data.content[0].name").value("Guava Fruit Box"))
                    .andExpect(jsonPath("$.data.content[1].name").value("Mango Fruit Box")).andReturn().getResponse().getContentAsString();
            var second = mvc.perform(get("/api/v1/products").header("Authorization", "Bearer " + token).param("size", "2").param("page", "1").param("sort", "name,asc"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.content", hasSize(1))).andReturn().getResponse().getContentAsString();
            assertThat(mapper.readTree(first).at("/data/content").findValuesAsText("id"))
                    .doesNotContainAnyElementsOf(mapper.readTree(second).at("/data/content").findValuesAsText("id"));
            mvc.perform(get("/api/v1/products").header("Authorization", "Bearer " + token).param("status", "ACTIVE").param("search", " mAnGo "))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(2));
            mvc.perform(get("/api/v1/products").header("Authorization", "Bearer " + token).param("status", "INACTIVE").param("search", "guava-box"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(1));
            mvc.perform(get("/api/v1/products").header("Authorization", "Bearer " + token).param("page", "999"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.content", hasSize(0))).andExpect(jsonPath("$.data.totalElements").value(3));
        }
        mvc.perform(admin(get("/api/v1/products")).param("sort", "price,desc"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.content[0].sku").value("MIXED-001"));
        mvc.perform(admin(get("/api/v1/products")).param("search", "%"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(0));
        mvc.perform(admin(get("/api/v1/products")).param("search", "_"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(0));
        mvc.perform(admin(get("/api/v1/products")).param("search", "   "))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3));
        assertThat(ProductSqlCapture.QUERIES).anyMatch(sql -> sql.contains("offset") && sql.contains("fetch first"));
        assertThat(ProductSqlCapture.QUERIES).anyMatch(sql -> sql.contains("where") && sql.contains("order by") && sql.contains("fetch first"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"page=-1", "page=bad", "size=0", "size=101", "status=UNKNOWN", "sort=batches,asc", "sort=name,no", "sort=name,asc,extra", "sort=class", "sort=,asc"})
    void invalidQueryParametersReturnSafe400(String query) throws Exception {
        var parts = query.split("=", -1);
        mvc.perform(admin(get("/api/v1/products")).param(parts[0], parts[1]))
                .andExpect(status().isBadRequest()).andExpect(content().string(not(containsString("Hibernate"))));
    }

    @Test
    void missingAndMalformedIdsReturn404And400ForAllExistingOperations() throws Exception {
        for (String id : List.of(UUID.randomUUID().toString(), "not-uuid")) {
            for (var request : List.of(get("/api/v1/products/" + id),
                    put("/api/v1/products/" + id).contentType("application/json").content(updateBody().toString()),
                    patch("/api/v1/products/" + id + "/status").contentType("application/json").content("{\"status\":\"INACTIVE\"}"))) {
                mvc.perform(admin(request)).andExpect(status().is(id.equals("not-uuid") ? 400 : 404));
            }
        }
    }

    @Test
    void profileReplacementUpdatesOnlyCatalogFieldsAndClearsOptionalFields() throws Exception {
        var input = updateBody().put("name", " Updated Mango ").put("description", "Updated description")
                .put("price", new BigDecimal("49900.99")).put("imageUrl", "https://example.com/updated.jpg");
        mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json").content(input.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.name").value("Updated Mango"))
                .andExpect(jsonPath("$.data.description").value("Updated description")).andExpect(jsonPath("$.data.price").value(49900.99))
                .andExpect(jsonPath("$.data.imageUrl").value("https://example.com/updated.jpg"))
                .andExpect(jsonPath("$.data.sku").value(mango.getSku())).andExpect(jsonPath("$.data.status").value("ACTIVE"));
        var updated = products.findById(mango.getId()).orElseThrow();
        assertThat(updated.getCreatedAt()).isEqualTo(mango.getCreatedAt());
        assertThat(updated.getUpdatedAt()).isAfterOrEqualTo(mango.getUpdatedAt());
        input.remove(List.of("description", "imageUrl"));
        mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json").content(input.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.description").isEmpty()).andExpect(jsonPath("$.data.imageUrl").isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"sku", "status", "id", "createdAt", "updatedAt", "quantity", "batchCode"})
    void generalUpdateRejectsImmutableFields(String field) throws Exception {
        mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json")
                .content(updateBody().put(field, "forbidden").toString())).andExpect(status().isBadRequest());
        var saved = products.findById(mango.getId()).orElseThrow();
        assertThat(saved.getSku()).isEqualTo(mango.getSku());
        assertThat(saved.getStatus()).isEqualTo(ProductStatus.ACTIVE);
    }

    @Test
    void statusRoundtripAndIdempotencePreserveIdentityAndCatalog() throws Exception {
        for (String status : List.of("INACTIVE", "INACTIVE", "ACTIVE")) {
            mvc.perform(admin(patch("/api/v1/products/" + mango.getId() + "/status")).contentType("application/json")
                    .content("{\"status\":\"" + status + "\"}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value(status));
            var saved = products.findById(mango.getId()).orElseThrow();
            assertThat(saved.getStatus().name()).isEqualTo(status);
            assertThat(saved.getPrice()).isEqualByComparingTo(mango.getPrice());
            assertThat(saved.getCreatedAt()).isEqualTo(mango.getCreatedAt());
        }
        mvc.perform(admin(delete("/api/v1/products/" + mango.getId()))).andExpect(status().isMethodNotAllowed());
        assertThat(products.count()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"status\":null}", "{\"status\":\"LOCKED\"}", "{\"status\":\"ACTIVE\",\"sku\":\"OTHER\"}", "null", "{"})
    void malformedOrUnknownStatusIs400(String input) throws Exception {
        mvc.perform(admin(patch("/api/v1/products/" + mango.getId() + "/status")).contentType("application/json").content(input))
                .andExpect(status().isBadRequest());
    }

    @Test
    void historicalBatchInventoryOrderAndPaymentSnapshotsAreUnchangedByPriceOrDeactivation() throws Exception {
        UUID batch = UUID.randomUUID(), inventory = UUID.randomUUID(), machine = UUID.randomUUID(), order = UUID.randomUUID(), item = UUID.randomUUID(), payment = UUID.randomUUID();
        jdbc.update("INSERT INTO product_batches(id,batch_code,product_id,manufactured_at,expires_at,quantity) VALUES (?, 'TEST-BATCH', ?, now(), now()+interval '2 days', 1)", batch, mango.getId());
        jdbc.update("INSERT INTO inventory_items(id,batch_id) VALUES (?, ?)", inventory, batch);
        jdbc.update("INSERT INTO machines(id,code,name) VALUES (?, 'TEST-VM', 'Fixture')", machine);
        jdbc.update("INSERT INTO orders(id,order_code,machine_id,subtotal,total_amount) VALUES (?, 'TEST-ORDER', ?, 35000.15, 35000.15)", order, machine);
        jdbc.update("INSERT INTO order_items(id,order_id,product_id,quantity,unit_price,total_price) VALUES (?, ?, ?, 1, 35000.15, 35000.15)", item, order, mango.getId());
        jdbc.update("INSERT INTO payments(id,order_id,provider,amount) VALUES (?, ?, 'TEST', 35000.15)", payment, order);
        var tables = List.of("product_batches", "inventory_items", "order_items", "orders", "payments");
        var before = tables.stream().map(table -> jdbc.queryForList("SELECT * FROM " + table)).toList();
        mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json")
                .content(updateBody().put("price", new BigDecimal("49900.99")).toString())).andExpect(status().isOk());
        mvc.perform(admin(patch("/api/v1/products/" + mango.getId() + "/status")).contentType("application/json")
                .content("{\"status\":\"INACTIVE\"}")).andExpect(status().isOk());
        for (int i = 0; i < tables.size(); i++) assertThat(jdbc.queryForList("SELECT * FROM " + tables.get(i))).isEqualTo(before.get(i));
        mvc.perform(admin(delete("/api/v1/products/" + mango.getId()))).andExpect(status().isMethodNotAllowed());
        assertThat(products.findById(mango.getId())).isPresent();
    }

    @Test
    void concurrentCatalogAndStatusUpdatesDoNotLoseEachOthersFields() throws Exception {
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var profile = executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json")
                        .content(updateBody().put("name", "Concurrent name").toString())).andReturn().getResponse().getStatus();
            });
            var statusChange = executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(patch("/api/v1/products/" + mango.getId() + "/status")).contentType("application/json")
                        .content("{\"status\":\"INACTIVE\"}")).andReturn().getResponse().getStatus();
            });
            assertThat(profile.get(20, TimeUnit.SECONDS)).isEqualTo(200);
            assertThat(statusChange.get(20, TimeUnit.SECONDS)).isEqualTo(200);
        }
        var saved = products.findById(mango.getId()).orElseThrow();
        assertThat(saved.getName()).isEqualTo("Concurrent name");
        assertThat(saved.getStatus()).isEqualTo(ProductStatus.INACTIVE);
    }

    @Test
    void everyEndpointUsesCurrentJwtRolesAndStaffWriteIsDeniedBeforeValidation() throws Exception {
        for (String token : List.of("", staffToken)) {
            var reads = List.of(get("/api/v1/products"), get("/api/v1/products/" + mango.getId()));
            for (var request : reads) {
                if (!token.isEmpty()) request.header("Authorization", "Bearer " + token);
                mvc.perform(request).andExpect(status().is(token.isEmpty() ? 401 : 200));
            }
            for (var request : List.of(post("/api/v1/products"), put("/api/v1/products/" + mango.getId()),
                    patch("/api/v1/products/" + mango.getId() + "/status"))) {
                if (!token.isEmpty()) request.header("Authorization", "Bearer " + token);
                mvc.perform(request.contentType("application/json").content("{"))
                        .andExpect(status().is(token.isEmpty() ? 401 : 403));
            }
        }
        jdbc.update("DELETE FROM user_roles WHERE user_id = ?", adminId);
        mvc.perform(admin(get("/api/v1/products"))).andExpect(status().isForbidden());
        mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(body("DENIED"))).andExpect(status().isForbidden());
        jdbc.update("UPDATE users SET status='INACTIVE' WHERE id=?", adminId);
        mvc.perform(admin(get("/api/v1/products"))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/products").header("Authorization", "Bearer invalid-token")).andExpect(status().isUnauthorized());
        assertThat(products.count()).isEqualTo(1);
    }


    @Test
    void malformedCatalogRequestsBlankUpdateNamesAndLongSearchReturn400() throws Exception {
        for (String input : List.of("{}", "null", "{", "{\"sku\":\"NEW\",\"name\":\"Name\",\"price\":\"not-money\"}")) {
            mvc.perform(admin(post("/api/v1/products")).contentType("application/json").content(input)).andExpect(status().isBadRequest());
            mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json").content(input)).andExpect(status().isBadRequest());
        }
        mvc.perform(admin(put("/api/v1/products/" + mango.getId())).contentType("application/json")
                .content(updateBody().put("name", "  ").toString())).andExpect(status().isBadRequest());
        mvc.perform(admin(get("/api/v1/products")).param("search", "a".repeat(201))).andExpect(status().isBadRequest());
    }

    @Test
    void allApprovedSortFieldsUseDatabaseOrderAndDeterministicTieBreak() throws Exception {
        product("ANOTHER", mango.getName(), ProductStatus.ACTIVE, "35000.15");
        for (String field : List.of("id", "sku", "name", "price", "status", "createdAt", "updatedAt")) {
            mvc.perform(admin(get("/api/v1/products")).param("sort", field + ",desc"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(2));
        }
        var response = mvc.perform(admin(get("/api/v1/products")).param("sort", "name")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        var expectedIds = jdbc.queryForList("SELECT id FROM products ORDER BY name ASC, id ASC", UUID.class).stream().map(UUID::toString).toList();
        assertThat(mapper.readTree(response).at("/data/content").findValuesAsText("id")).isEqualTo(expectedIds);
    }

    @Test
    @WithMockUser(roles = "ADMIN", setupBefore = org.springframework.security.test.context.support.TestExecutionEvent.TEST_EXECUTION)
    void serviceValidatesPositivePriceAndStrictMoneyPrecisionOutsideMvc() {
        assertThatThrownBy(() -> service.createProduct(new CreateProductRequest("BAD", "Name", null, BigDecimal.ZERO, null)))
                .isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThatThrownBy(() -> service.updateProduct(mango.getId(), new UpdateProductRequest("Name", null, new BigDecimal("1.001"), null)))
                .isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThatThrownBy(() -> service.updateStatus(mango.getId(), new UpdateProductStatusRequest(null)))
                .isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThat(products.count()).isEqualTo(1);
    }

    @Test
    @WithMockUser(roles = "STAFF", setupBefore = org.springframework.security.test.context.support.TestExecutionEvent.TEST_EXECUTION)
    void serviceWriteBoundaryAlsoEnforcesAdminWhenNotInvokedThroughController() {
        assertThatThrownBy(() -> service.createProduct(new CreateProductRequest("DENIED", "Name", null, BigDecimal.ONE, null)))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.updateProduct(mango.getId(), new UpdateProductRequest("Name", null, BigDecimal.ONE, null)))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.updateStatus(mango.getId(), new UpdateProductStatusRequest(ProductStatus.INACTIVE)))
                .isInstanceOf(AccessDeniedException.class);
    }
}
