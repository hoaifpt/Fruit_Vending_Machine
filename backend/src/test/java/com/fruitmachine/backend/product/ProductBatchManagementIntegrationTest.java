package com.fruitmachine.backend.product;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.product.batch.dto.CreateProductBatchRequest;
import com.fruitmachine.backend.product.batch.repository.ProductBatchRepository;
import com.fruitmachine.backend.product.batch.service.ProductBatchService;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.repository.ProductRepository;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.config.import=", "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.fruitmachine.backend.product.ProductBatchManagementIntegrationTest$SqlCapture"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@Testcontainers
class ProductBatchManagementIntegrationTest {
    public static class SqlCapture implements org.hibernate.resource.jdbc.spi.StatementInspector {
        static final List<String> QUERIES = new CopyOnWriteArrayList<>();
        public String inspect(String sql) { QUERIES.add(sql); return sql; }
    }
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    static final String KEY = newKey();
    static final String PASSWORD = "Test-only-batch-passphrase!";
    static final Instant NOW = Instant.parse("2030-10-10T02:00:00Z");
    static final String PATH = "/api/v1/product-batches";
    static String newKey() {
        byte[] bytes = new byte[32]; new java.security.SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-batch@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired ProductRepository products;
    @MockitoSpyBean ProductBatchRepository batches;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;
    @Autowired ProductBatchService service;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired com.fruitmachine.backend.security.jwt.JwtService tokens;
    @MockitoSpyBean Clock clock;
    String adminToken, staffToken, rolelessToken;
    UUID adminId, staffId;
    Product product, other;
    @BeforeEach void setup() throws Exception {
        doReturn(NOW).when(clock).instant();
        for (String table : List.of("inventory_items", "product_batches", "products", "machine_slots", "machines", "user_roles", "users")) jdbc.update("DELETE FROM " + table);
        adminToken = login("ADMIN"); staffToken = login("STAFF"); rolelessToken = login("");
        product = product("MANGO"); other = product("ORANGE");
        SqlCapture.QUERIES.clear();
    }
    @AfterEach void clearSecurityContext() { SecurityContextHolder.clearContext(); }
    String login(String role) throws Exception {
        var user = new User(); user.setEmail(UUID.randomUUID() + "@example.invalid"); user.setFullName("Batch tester");
        user.setPasswordHash(encoder.encode(PASSWORD)); users.saveAndFlush(user);
        if (!role.isEmpty()) jdbc.update("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?", user.getId(), role);
        if (role.equals("ADMIN")) adminId = user.getId(); if (role.equals("STAFF")) staffId = user.getId();
        var response = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(mapper.writeValueAsString(Map.of("email", user.getEmail(), "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(response).at("/data/accessToken").asText();
    }
    Product product(String sku) {
        var result = new Product(); result.setSku(sku); result.setName(sku + " Fruit Box"); result.setPrice(BigDecimal.ONE);
        return products.saveAndFlush(result);
    }
    ObjectNode body(String code) {
        return mapper.createObjectNode().put("batchCode", code).put("productId", product.getId().toString())
                .put("manufacturedAt", "2030-10-10T08:00:00+07:00").put("expiresAt", "2030-10-12T08:00:00+07:00").put("quantity", 20);
    }
    MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request, String token) { return request.header("Authorization", "Bearer " + token); }
    UUID create(String code, String token) throws Exception {
        var response = mvc.perform(auth(post(PATH), token).contentType("application/json").content(body(code).toString()))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(mapper.readTree(response).at("/data/id").asText());
    }

    @Test void bothRolesCreateWithServerCreatorUtcAndSafeDtosWithoutChangingOtherEntities() throws Exception {
        var before = jdbc.queryForList("SELECT * FROM products ORDER BY id");
        for (String token : List.of(adminToken, staffToken)) {
            UUID creator = token.equals(adminToken) ? adminId : staffId;
            String code = token.equals(adminToken) ? " mango-1 " : " mango-2 ";
            var response = mvc.perform(auth(post(PATH), token).contentType("application/json").content(body(code).toString()))
                    .andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.data.createdBy").value(creator.toString()))
                    .andExpect(jsonPath("$.data.productSku").value("MANGO"))
                    .andExpect(jsonPath("$.data.productName").value("MANGO Fruit Box"))
                    .andExpect(jsonPath("$.data.manufacturedAt").value("2030-10-10T01:00:00Z"))
                    .andExpect(jsonPath("$.data.expiresAt").value("2030-10-12T01:00:00Z"))
                    .andReturn().getResponse();
            var data = mapper.readTree(response.getContentAsString()).path("data");
            assertThat(data.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "batchCode", "productId", "productSku", "productName", "manufacturedAt", "expiresAt", "quantity", "createdBy", "createdAt");
            UUID id = UUID.fromString(data.path("id").asText()); assertThat(response.getHeader("Location")).isEqualTo(PATH + "/" + id);
            assertThat(data.path("batchCode").asText()).isEqualTo(code.strip().toUpperCase(Locale.ROOT));
            assertThat(Instant.parse(data.path("createdAt").asText())).isNotNull();
            assertThat(jdbc.queryForObject("SELECT product_id FROM product_batches WHERE id=?", UUID.class, id)).isEqualTo(product.getId());
            assertThat(jdbc.queryForObject("SELECT created_by FROM product_batches WHERE id=?", UUID.class, id)).isEqualTo(creator);
            assertThat(jdbc.queryForObject("SELECT quantity FROM product_batches WHERE id=?", Integer.class, id)).isEqualTo(20);
        }
        assertThat(jdbc.queryForList("SELECT * FROM products ORDER BY id")).isEqualTo(before);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM machine_slots", Integer.class)).isZero();
    }
    @ParameterizedTest @ValueSource(strings = {"batchCode", "productId", "manufacturedAt", "expiresAt", "quantity"})
    void requiredFieldsRejectMissingAndNull(String field) throws Exception {
        var request = body("INVALID"); request.remove(field);
        mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        request.putNull(field);
        mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        assertThat(batches.count()).isZero();
    }
    @ParameterizedTest @ValueSource(strings = {"0", "-1", "1.5", "6.0", "\"20\"", "2147483648", "true", "{}", "[]"})
    void quantityRejectsInvalidTokensAndBounds(String value) throws Exception {
        var request = body("INVALID"); request.set("quantity", mapper.readTree(value));
        mvc.perform(auth(post(PATH), staffToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        assertThat(batches.count()).isZero();
    }
    @ParameterizedTest @ValueSource(strings = {"createdBy", "createdAt", "id", "inventory", "remainingQuantity", "slotId", "machineId", "status"})
    void rejectsImpersonationAndUnknownFields(String field) throws Exception {
        var request = body("INVALID"); request.put(field, adminId.toString());
        mvc.perform(auth(post(PATH), staffToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        assertThat(batches.count()).isZero();
    }
    @Test void validatesCodeProductAndGlobalNormalizedUniqueness() throws Exception {
        for (String code : List.of(" ", "X".repeat(65))) mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(body(code).toString())).andExpect(status().isBadRequest());
        var request = body("MISSING").put("productId", UUID.randomUUID().toString());
        mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(request.toString())).andExpect(status().isNotFound());
        request.put("productId", "bad-uuid");
        mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        jdbc.update("UPDATE products SET status='INACTIVE' WHERE id=?", other.getId());
        request = body("INACTIVE").put("productId", other.getId().toString());
        mvc.perform(auth(post(PATH), staffToken).contentType("application/json").content(request.toString())).andExpect(status().isConflict());
        create(" code ", adminToken);
        request = body("CoDe").put("productId", other.getId().toString());
        mvc.perform(auth(post(PATH), staffToken).contentType("application/json").content(request.toString())).andExpect(status().isConflict());
        var max = body("X".repeat(64)).put("quantity", Integer.MAX_VALUE);
        mvc.perform(auth(post(PATH), staffToken).contentType("application/json").content(max.toString())).andExpect(status().isCreated());
    }

    @ParameterizedTest @ValueSource(strings = {"\"2030-10-10\"", "\"2030-10-10T08:00:00\"", "\"not-a-date\"", "123", "true"})
    void timestampsRequireIsoStringsWithOffsets(String value) throws Exception {
        for (String field : List.of("manufacturedAt", "expiresAt")) {
            var request = body("INVALID"); request.set(field, mapper.readTree(value));
            mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        }
    }
    @Test void databasePagesProductFiltersToOneFetchesAndStableSorts() throws Exception {
        create("B", adminToken); create("A", staffToken);
        var otherBody = body("C").put("productId", other.getId().toString());
        mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(otherBody.toString())).andExpect(status().isCreated());
        for (String token : List.of(adminToken, staffToken)) {
            SqlCapture.QUERIES.clear();
            var response = mvc.perform(auth(get(PATH), token).param("page", "0").param("size", "1").param("productId", product.getId().toString()).param("sort", "batchCode,asc"))
                    .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.data.totalElements").value(2)).andExpect(jsonPath("$.data.totalPages").value(2))
                    .andExpect(jsonPath("$.data.content.length()").value(1)).andExpect(jsonPath("$.data.content[0].batchCode").value("A"))
                    .andReturn().getResponse().getContentAsString();
            assertThat(response).doesNotContain("passwordHash", "inventoryItems", "userRoles", PASSWORD, KEY);
            assertThat(SqlCapture.QUERIES).anyMatch(sql -> sql.contains("product_batches") && sql.contains("fetch first"));
            assertThat(SqlCapture.QUERIES).noneMatch(sql -> sql.contains("inventory_items") || sql.contains("machine_slots"));
            assertThat(SqlCapture.QUERIES.stream().filter(sql -> sql.startsWith("select") && sql.contains("product_batches") && !sql.contains("count(")).count()).isEqualTo(1);
            mvc.perform(auth(get(PATH), token).param("page", "1").param("size", "1").param("productId", product.getId().toString()).param("sort", "batchCode"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.content[0].batchCode").value("B"));
            mvc.perform(auth(get(PATH), token).param("page", "9").param("size", "1")).andExpect(status().isOk()).andExpect(jsonPath("$.data.content").isEmpty());
            mvc.perform(auth(get(PATH), token).param("productId", UUID.randomUUID().toString())).andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(0));
        }
        for (String sort : List.of("id", "batchCode", "manufacturedAt", "expiresAt", "quantity", "createdAt"))
            mvc.perform(auth(get(PATH), adminToken).param("sort", sort + ",desc")).andExpect(status().isOk());
        mvc.perform(auth(get(PATH), adminToken).param("sort", "")).andExpect(status().isOk());
        for (String sort : List.of("bad", "product.name", "createdBy.passwordHash", "createdAt,sideways", "id,asc,desc"))
            mvc.perform(auth(get(PATH), adminToken).param("sort", sort)).andExpect(status().isBadRequest());
        for (String[] query : List.of(new String[]{"page", "-1"}, new String[]{"size", "0"}, new String[]{"size", "101"}, new String[]{"productId", "invalid"}))
            mvc.perform(auth(get(PATH), staffToken).param(query[0], query[1])).andExpect(status().isBadRequest());
    }
    @Test void detailRemainsReadableAfterProductDeactivationExpirationAndInventoryFixtureChanges() throws Exception {
        UUID id = create("HISTORY", staffToken);
        var before = jdbc.queryForList("SELECT * FROM product_batches WHERE id=?", id);
        jdbc.update("UPDATE products SET status='INACTIVE' WHERE id=?", product.getId());
        doReturn(NOW.plus(Duration.ofDays(4))).when(clock).instant();
        // Mint fresh signed tokens under the advanced clock; old access tokens are expired.
        var principal = new AuthenticatedUser(adminId, "test@example.invalid", "", UserStatus.ACTIVE, List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
        String currentToken = tokens.generateToken(principal);
        var staffPrincipal = new AuthenticatedUser(staffId, "staff@example.invalid", "", UserStatus.ACTIVE, List.of(new SimpleGrantedAuthority("ROLE_STAFF")));
        for (String token : List.of(currentToken, tokens.generateToken(staffPrincipal))) {
            mvc.perform(auth(get(PATH + "/" + id), token)).andExpect(status().isOk()).andExpect(jsonPath("$.data.createdBy").value(staffId.toString()));
            mvc.perform(auth(get(PATH), token)).andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(1));
        }
        UUID item = UUID.randomUUID();
        jdbc.update("INSERT INTO inventory_items(id,batch_id) VALUES (?,?)", item, id);
        jdbc.update("UPDATE inventory_items SET status='EXPIRED' WHERE id=?", item);
        assertThat(jdbc.queryForList("SELECT * FROM product_batches WHERE id=?", id)).isEqualTo(before);
    }
    @Test void bothRolesReadDetailsLegacyNullableCreatorAndHandleMissingIds() throws Exception {
        UUID id = create("DETAIL", adminToken);
        for (String token : List.of(adminToken, staffToken)) {
            mvc.perform(auth(get(PATH + "/" + id), token)).andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.productId").value(product.getId().toString())).andExpect(jsonPath("$.data.createdBy").value(adminId.toString()));
            mvc.perform(auth(get(PATH + "/" + UUID.randomUUID()), token)).andExpect(status().isNotFound());
            mvc.perform(auth(get(PATH + "/bad-id"), token)).andExpect(status().isBadRequest());
        }
        jdbc.update("UPDATE product_batches SET created_by=NULL WHERE id=?", id);
        mvc.perform(auth(get(PATH + "/" + id), staffToken)).andExpect(status().isOk()).andExpect(jsonPath("$.data.createdBy").doesNotExist());
    }
    @Test void noUpdateOrDeleteRoutesAndNoParentOrInventoryModification() throws Exception {
        UUID machine = UUID.randomUUID(), slot = UUID.randomUUID();
        jdbc.update("INSERT INTO machines(id,code,name) VALUES (?,'FIXTURE','Fixture')", machine);
        jdbc.update("INSERT INTO machine_slots(id,machine_id,slot_code,capacity) VALUES (?,?,'A1',6)", slot, machine);
        var slotBefore = jdbc.queryForList("SELECT * FROM machine_slots");
        UUID id = create("IMMUTABLE", adminToken);
        var batchBefore = jdbc.queryForList("SELECT * FROM product_batches");
        for (String token : List.of(adminToken, staffToken)) for (var request : List.of(put(PATH + "/" + id), patch(PATH + "/" + id), delete(PATH + "/" + id)))
            mvc.perform(auth(request, token).contentType("application/json").content("{}" )).andExpect(status().isMethodNotAllowed());
        assertThat(jdbc.queryForList("SELECT * FROM product_batches")).isEqualTo(batchBefore);
        assertThat(jdbc.queryForList("SELECT * FROM machine_slots")).isEqualTo(slotBefore);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items", Integer.class)).isZero();
    }
    @Test void realJwtRolesAndAccountStatusEnforcedBeforeValidation() throws Exception {
        UUID id = create("SECURITY", adminToken);
        for (String path : List.of(PATH, PATH + "/" + id)) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized()).andExpect(header().string("WWW-Authenticate", "Bearer"));
            mvc.perform(auth(get(path), rolelessToken)).andExpect(status().isForbidden());
            mvc.perform(auth(get(path), "invalid-token")).andExpect(status().isUnauthorized());
        }
        mvc.perform(post(PATH).contentType("application/json").content("bad")).andExpect(status().isUnauthorized());
        mvc.perform(auth(post(PATH), rolelessToken).contentType("application/json").content("bad")).andExpect(status().isForbidden());
        jdbc.update("DELETE FROM user_roles WHERE user_id=?", staffId);
        mvc.perform(auth(post(PATH), staffToken).contentType("application/json").content("bad")).andExpect(status().isForbidden());
        jdbc.update("UPDATE users SET status='INACTIVE' WHERE id=?", adminId);
        mvc.perform(auth(get(PATH), adminToken)).andExpect(status().isUnauthorized());
        mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(body("DENIED").toString())).andExpect(status().isUnauthorized());
        assertThat(batches.count()).isEqualTo(1);
    }
    @Test void simultaneousNormalizedCodeCreatesReturnOne201One409FromDatabaseGuard() throws Exception {
        var barrier = new CyclicBarrier(2);
        doAnswer(invocation -> { barrier.await(10, TimeUnit.SECONDS); return false; }).when(batches).existsByBatchCode("RACE");
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(body(" race ").toString())).andReturn().getResponse());
            var second = executor.submit(() -> mvc.perform(auth(post(PATH), staffToken).contentType("application/json").content(body("RaCe").put("productId", other.getId().toString()).toString())).andReturn().getResponse());
            var a = first.get(20, TimeUnit.SECONDS); var b = second.get(20, TimeUnit.SECONDS);
            assertThat(List.of(a.getStatus(), b.getStatus())).containsExactlyInAnyOrder(201, 409);
            assertThat((a.getStatus() == 409 ? a : b).getContentAsString()).doesNotContain("SQL", "Hibernate", "constraint", KEY, PASSWORD);
        }
        assertThat(batches.count()).isEqualTo(1);
    }
    @Test void productDeactivationCommittedWhileCreateWaitsPreventsNewBatch() throws Exception {
        var ready = new CountDownLatch(1);
        doAnswer(invocation -> { ready.countDown(); return false; }).when(batches).existsByBatchCode("DEACTIVATION-RACE");
        try (var executor = Executors.newSingleThreadExecutor()) {
            var result = new org.springframework.transaction.support.TransactionTemplate(transactions).execute(transaction -> {
                jdbc.queryForObject("SELECT id FROM products WHERE id=? FOR UPDATE", UUID.class, product.getId());
                var pending = executor.submit(() -> mvc.perform(auth(post(PATH), staffToken).contentType("application/json")
                        .content(body("DEACTIVATION-RACE").toString())).andReturn().getResponse().getStatus());
                try { assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); }
                catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new IllegalStateException(exception); }
                jdbc.update("UPDATE products SET status='INACTIVE' WHERE id=?", product.getId());
                return pending;
            });
            assertThat(result.get(20, TimeUnit.SECONDS)).isEqualTo(409);
        }
        assertThat(batches.count()).isZero();
    }
    @Test void serviceGuardAndValidationCannotBeBypassedOutsideMvc() {
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new UsernamePasswordAuthenticationToken("roleless", null, List.of())); SecurityContextHolder.setContext(context);
        assertThatThrownBy(() -> service.listBatches(0, 20, null, null)).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.getBatch(UUID.randomUUID())).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.createBatch(null)).isInstanceOf(AccessDeniedException.class);
        var principal = new AuthenticatedUser(staffId, "test@example.invalid", "", UserStatus.ACTIVE, List.of(new SimpleGrantedAuthority("ROLE_STAFF")));
        context.setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
        assertThatThrownBy(() -> service.createBatch(new CreateProductBatchRequest("BAD", product.getId(), NOW, NOW.plusSeconds(60), 0))).isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThatThrownBy(() -> service.createBatch(new CreateProductBatchRequest("BAD", product.getId(), NOW, NOW, 1))).isInstanceOf(com.fruitmachine.backend.common.exception.BadRequestException.class);
    }
    @Test void dateRulesCompareInstantsAndRejectBoundaryBeforeAndAfterMicrosecondNormalization() throws Exception {
        for (String expiry : List.of("2030-10-10T01:00:00Z", "2030-10-09T23:00:00Z", NOW.toString())) {
            var request = body("INVALID").put("expiresAt", expiry);
            mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        }
        var equal = body("INVALID").put("manufacturedAt", "2030-10-12T01:00:00.0000001Z").put("expiresAt", "2030-10-12T01:00:00.0000009Z");
        mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(equal.toString())).andExpect(status().isBadRequest());
        var valid = body("MICRO").put("manufacturedAt", "2030-10-10T01:00:00.123456789Z").put("expiresAt", "2030-10-12T08:00:00.123456789+07:00");
        mvc.perform(auth(post(PATH), staffToken).contentType("application/json").content(valid.toString())).andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.manufacturedAt").value("2030-10-10T01:00:00.123456Z"))
                .andExpect(jsonPath("$.data.expiresAt").value("2030-10-12T01:00:00.123456Z"));
        var atNow = body("JUST-AFTER").put("expiresAt", NOW.plusNanos(1000).toString());
        mvc.perform(auth(post(PATH), adminToken).contentType("application/json").content(atNow.toString())).andExpect(status().isCreated());
    }
}
