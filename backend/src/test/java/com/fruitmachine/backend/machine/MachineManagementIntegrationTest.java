package com.fruitmachine.backend.machine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.machine.dto.*;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.service.MachineService;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.Instant;
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

@SpringBootTest(properties = {"spring.config.import=",
        "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.fruitmachine.backend.machine.MachineManagementIntegrationTest$SqlCapture"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@Testcontainers
class MachineManagementIntegrationTest {
    public static class SqlCapture implements org.hibernate.resource.jdbc.spi.StatementInspector {
        static final List<String> QUERIES = new CopyOnWriteArrayList<>();
        public String inspect(String sql) {
            if (sql.contains("from machines")) QUERIES.add(sql);
            return sql;
        }
    }
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    static final String PASSWORD = "Test-only-machine-passphrase!";
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
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-machine@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;
    @MockitoSpyBean MachineRepository machines;
    @Autowired MachineService service;
    String adminToken, staffToken;
    UUID adminId;
    Machine campus;

    @BeforeEach
    void setup() throws Exception {
        // Delete only fixtures inside this test's disposable container.
        for (String table : List.of("payments", "orders", "alerts", "sensor_readings", "machine_events",
                "inventory_items", "product_batches", "products", "machine_slots", "machines", "user_roles", "users"))
            jdbc.update("DELETE FROM " + table);
        adminToken = accountAndLogin("ADMIN");
        staffToken = accountAndLogin("STAFF");
        campus = machine("FV-HCM-001", "Campus A", "Building A", MachineStatus.ACTIVE);
    }
    String accountAndLogin(String role) throws Exception {
        var user = new User();
        user.setEmail(UUID.randomUUID() + "@example.invalid");
        user.setFullName("Isolated machine tester");
        user.setPasswordHash(encoder.encode(PASSWORD));
        users.saveAndFlush(user);
        jdbc.update("INSERT INTO user_roles(user_id,role_id) SELECT ?, id FROM roles WHERE name=?", user.getId(), role);
        if (role.equals("ADMIN")) adminId = user.getId();
        String response = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(mapper.writeValueAsString(Map.of("email", user.getEmail(), "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(response).at("/data/accessToken").asText();
    }
    Machine machine(String code, String name, String location, MachineStatus status) {
        var machine = new Machine();
        machine.setCode(code); machine.setName(name); machine.setLocation(location); machine.setStatus(status);
        return machines.saveAndFlush(machine);
    }
    MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + adminToken);
    }
    ObjectNode body(String code) {
        return mapper.createObjectNode().put("code", code).put("name", " Campus B ").put("location", " Building B ")
                .put("minTemperature", new BigDecimal("2.15")).put("maxTemperature", new BigDecimal("8.75"))
                .put("minHumidity", new BigDecimal("40.25")).put("maxHumidity", new BigDecimal("80.99"));
    }
    ObjectNode updateBody() {
        var input = body("ignored"); input.remove("code"); return input;
    }
    void invalidCreateAndUpdate(ObjectNode input) throws Exception {
        mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(input.toString()))
                .andExpect(status().isBadRequest());
        input.remove("code");
        mvc.perform(admin(put("/api/v1/machines/" + campus.getId())).contentType("application/json").content(input.toString()))
                .andExpect(status().isBadRequest());
        assertThat(machines.count()).isEqualTo(1);
        assertThat(machines.findById(campus.getId()).orElseThrow().getName()).isEqualTo("Campus A");
    }

    @Test
    void adminRegistersInactiveNormalizedMachineWithExactThresholdsAndSafeDto() throws Exception {
        var response = mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(body(" fv-hcm-002 ").toString()))
                .andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.code").value("FV-HCM-002")).andExpect(jsonPath("$.data.name").value("Campus B"))
                .andExpect(jsonPath("$.data.location").value("Building B")).andExpect(jsonPath("$.data.status").value("INACTIVE"))
                .andReturn().getResponse();
        var data = mapper.readTree(response.getContentAsString()).path("data");
        assertThat(data.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "code", "name", "location", "status",
                "minTemperature", "maxTemperature", "minHumidity", "maxHumidity", "lastSeenAt", "createdAt", "updatedAt");
        assertThat(data.path("lastSeenAt").isNull()).isTrue();
        UUID id = UUID.fromString(data.path("id").asText());
        assertThat(response.getHeader("Location")).isEqualTo("/api/v1/machines/" + id);
        var saved = machines.findById(id).orElseThrow();
        assertThat(saved.getStatus()).isEqualTo(MachineStatus.INACTIVE);
        assertThat(saved.getTemperatureMin()).isEqualByComparingTo("2.15");
        assertThat(saved.getTemperatureMax()).isEqualByComparingTo("8.75");
        assertThat(saved.getHumidityMin()).isEqualByComparingTo("40.25");
        assertThat(saved.getHumidityMax()).isEqualByComparingTo("80.99");
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isAfterOrEqualTo(saved.getCreatedAt());
        assertThat(data.path("createdAt").asText()).endsWith("Z");
    }

    @Test
    void normalizedDuplicateAndConcurrentUniqueConstraintAreSafe409() throws Exception {
        mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(body(" fv-hcm-001 ").toString()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("Machine code is already in use"));
        // Bypass the precheck to exercise the DB's final uniqueness guard.
        doReturn(false).when(machines).existsByCode("RACE-CODE");
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var jobs = java.util.stream.IntStream.range(0, 2).mapToObj(i -> executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(body("race-code").toString()))
                        .andReturn().getResponse();
            })).toList();
            var responses = List.of(jobs.get(0).get(20, TimeUnit.SECONDS), jobs.get(1).get(20, TimeUnit.SECONDS));
            assertThat(responses).extracting(r -> r.getStatus()).containsExactlyInAnyOrder(201, 409);
            assertThat(responses.stream().filter(r -> r.getStatus() == 409).findFirst().orElseThrow().getContentAsString())
                    .contains("Request conflicts with existing data").doesNotContain("duplicate key", "Hibernate", "SQL");
        }
        assertThat(machines.count()).isEqualTo(2);
    }

    @ParameterizedTest
    @ValueSource(strings = {"code", "name", "location", "minTemperature", "maxTemperature", "minHumidity", "maxHumidity"})
    void requiredFieldsRejectMissingNullBlankOrOversizedValues(String field) throws Exception {
        for (boolean missing : List.of(true, false)) {
            var input = body("NEW");
            if (missing) input.remove(field); else input.putNull(field);
            if (field.equals("code")) {
                mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(input.toString())).andExpect(status().isBadRequest());
            } else invalidCreateAndUpdate(input);
        }
        if (List.of("code", "name", "location").contains(field)) {
            for (String value : List.of("  ", "A".repeat(field.equals("code") ? 65 : field.equals("name") ? 201 : 501))) {
                var input = body("NEW").put(field, value);
                if (field.equals("code"))
                    mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(input.toString())).andExpect(status().isBadRequest());
                else invalidCreateAndUpdate(input);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"minTemperature=8.75", "minTemperature=10", "minTemperature=-100.01", "maxTemperature=100.01",
            "minTemperature=2.151", "maxTemperature=8.751", "minHumidity=80.99", "minHumidity=90", "minHumidity=-0.01",
            "maxHumidity=100.01", "minHumidity=40.251", "maxHumidity=80.991"})
    void invalidRangeBoundsAndPrecisionAre400WithoutRounding(String input) throws Exception {
        var parts = input.split("=");
        invalidCreateAndUpdate(body("NEW").put(parts[0], new BigDecimal(parts[1])));
    }

    @Test
    void exactValidThresholdBoundariesPersist() throws Exception {
        var input = body("BOUNDARY").put("minTemperature", -100).put("maxTemperature", 100).put("minHumidity", 0).put("maxHumidity", 100);
        mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(input.toString())).andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT temperature_min FROM machines WHERE code='BOUNDARY'", BigDecimal.class)).isEqualByComparingTo("-100");
        assertThat(jdbc.queryForObject("SELECT humidity_max FROM machines WHERE code='BOUNDARY'", BigDecimal.class)).isEqualByComparingTo("100");
    }

    @ParameterizedTest
    @ValueSource(strings = {"id", "status", "lastSeenAt", "createdAt", "updatedAt", "slotCode", "slotCapacity", "motorNumber", "GPIO", "inventory", "temperature"})
    void createAndConfigurationUpdateRejectReadOnlyAndUnrelatedFields(String field) throws Exception {
        invalidCreateAndUpdate(body("NEW").put(field, "forbidden"));
    }

    @Test
    void configurationReplacementPreservesIdentityStatusHeartbeatAndCreation() throws Exception {
        Instant seen = Instant.parse("2026-10-01T00:00:00Z");
        jdbc.update("UPDATE machines SET last_seen_at=? WHERE id=?", java.sql.Timestamp.from(seen), campus.getId());
        mvc.perform(admin(put("/api/v1/machines/" + campus.getId())).contentType("application/json").content(updateBody().toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.name").value("Campus B"))
                .andExpect(jsonPath("$.data.location").value("Building B")).andExpect(jsonPath("$.data.minTemperature").value(2.15))
                .andExpect(jsonPath("$.data.maxTemperature").value(8.75)).andExpect(jsonPath("$.data.minHumidity").value(40.25))
                .andExpect(jsonPath("$.data.maxHumidity").value(80.99)).andExpect(jsonPath("$.data.code").value(campus.getCode()))
                .andExpect(jsonPath("$.data.status").value("ACTIVE")).andExpect(jsonPath("$.data.lastSeenAt").value(seen.toString()));
        mvc.perform(admin(put("/api/v1/machines/" + campus.getId())).contentType("application/json")
                .content(updateBody().put("code", "CHANGED").toString())).andExpect(status().isBadRequest());
        var saved = machines.findById(campus.getId()).orElseThrow();
        assertThat(saved.getCode()).isEqualTo(campus.getCode());
        assertThat(saved.getCreatedAt()).isEqualTo(campus.getCreatedAt());
        assertThat(saved.getUpdatedAt()).isAfterOrEqualTo(campus.getUpdatedAt());
    }

    @Test
    void statusLifecycleIdempotenceAndNoHardDelete() throws Exception {
        for (String value : List.of("INACTIVE", "ACTIVE", "MAINTENANCE", "ACTIVE", "INACTIVE", "INACTIVE")) {
            mvc.perform(admin(patch("/api/v1/machines/" + campus.getId() + "/status")).contentType("application/json")
                    .content(mapper.writeValueAsString(Map.of("status", value))))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value(value));
            var saved = machines.findById(campus.getId()).orElseThrow();
            assertThat(saved.getStatus().name()).isEqualTo(value);
            assertThat(saved.getName()).isEqualTo(campus.getName());
            assertThat(saved.getTemperatureMin()).isEqualByComparingTo(campus.getTemperatureMin());
            assertThat(saved.getCreatedAt()).isEqualTo(campus.getCreatedAt());
        }
        mvc.perform(admin(delete("/api/v1/machines/" + campus.getId()))).andExpect(status().isMethodNotAllowed());
        assertThat(machines.count()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"status\":null}", "{\"status\":\"OFFLINE\"}", "{\"status\":\"ACTIVE\",\"code\":\"OTHER\"}", "null", "{"})
    void invalidStatusIs400(String input) throws Exception {
        mvc.perform(admin(patch("/api/v1/machines/" + campus.getId() + "/status")).contentType("application/json").content(input))
                .andExpect(status().isBadRequest());
    }

    @Test
    void missingMalformedIdsAndLegacyNullableFieldsAreSafe() throws Exception {
        var legacy = machine("LEGACY", "Legacy", null, MachineStatus.INACTIVE);
        var response = mvc.perform(admin(get("/api/v1/machines/" + legacy.getId()))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(response).at("/data/location").isNull()).isTrue();
        assertThat(mapper.readTree(response).at("/data/lastSeenAt").isNull()).isTrue();
        for (String id : List.of(UUID.randomUUID().toString(), "not-uuid")) {
            for (var request : List.of(get("/api/v1/machines/" + id),
                    put("/api/v1/machines/" + id).contentType("application/json").content(updateBody().toString()),
                    patch("/api/v1/machines/" + id + "/status").contentType("application/json").content("{\"status\":\"ACTIVE\"}")))
                mvc.perform(admin(request)).andExpect(status().is(id.equals("not-uuid") ? 400 : 404));
        }
    }

    @Test
    void adminStaffReadDatabasePagesCombinedFiltersLiteralSearchAndDeterministicSort() throws Exception {
        machine("FV-HN-002", "Campus B", "Hanoi", MachineStatus.INACTIVE);
        machine("FV-HCM-003", "Campus A", "Building C", MachineStatus.MAINTENANCE);
        SqlCapture.QUERIES.clear();
        for (String token : List.of(adminToken, staffToken)) {
            mvc.perform(get("/api/v1/machines/" + campus.getId()).header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.code").value("FV-HCM-001"));
            var first = mvc.perform(get("/api/v1/machines").header("Authorization", "Bearer " + token).param("size", "2").param("sort", "name,asc"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3))
                    .andExpect(jsonPath("$.data.totalPages").value(2)).andExpect(jsonPath("$.data.content", hasSize(2)))
                    .andReturn().getResponse().getContentAsString();
            var second = mvc.perform(get("/api/v1/machines").header("Authorization", "Bearer " + token).param("size", "2").param("page", "1").param("sort", "name,asc"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.content", hasSize(1))).andReturn().getResponse().getContentAsString();
            assertThat(mapper.readTree(first).at("/data/content").findValuesAsText("id"))
                    .doesNotContainAnyElementsOf(mapper.readTree(second).at("/data/content").findValuesAsText("id"));
            mvc.perform(get("/api/v1/machines").header("Authorization", "Bearer " + token).param("status", "MAINTENANCE").param("search", " hCm "))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(1));
        }
        for (String value : List.of("Campus", "BUILDING", "FV-HCM")) {
            mvc.perform(admin(get("/api/v1/machines")).param("search", value))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(value.equals("Campus") ? 3 : 2));
        }
        for (String value : List.of("%", "_")) {
            mvc.perform(admin(get("/api/v1/machines")).param("search", value))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(0));
        }
        mvc.perform(admin(get("/api/v1/machines")).param("search", "  "))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.size").value(20)).andExpect(jsonPath("$.data.totalElements").value(3));
        mvc.perform(admin(get("/api/v1/machines")).param("page", "999"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.content", hasSize(0))).andExpect(jsonPath("$.data.totalElements").value(3));
        for (String field : List.of("id", "code", "name", "location", "status", "createdAt", "updatedAt")) {
            var response = mvc.perform(admin(get("/api/v1/machines")).param("sort", field + ",desc")).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            String column = field.equals("createdAt") ? "created_at" : field.equals("updatedAt") ? "updated_at" : field;
            var expected = jdbc.queryForList("SELECT id FROM machines ORDER BY " + column + " DESC" + (field.equals("id") ? "" : ", id ASC"), UUID.class)
                    .stream().map(UUID::toString).toList();
            assertThat(mapper.readTree(response).at("/data/content").findValuesAsText("id")).isEqualTo(expected);
        }
        var response = mvc.perform(admin(get("/api/v1/machines")).param("sort", "name")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(response).at("/data/content").findValuesAsText("id")).isEqualTo(
                jdbc.queryForList("SELECT id FROM machines ORDER BY name, id", UUID.class).stream().map(UUID::toString).toList());
        assertThat(SqlCapture.QUERIES).anyMatch(sql -> sql.contains("offset") && sql.contains("fetch first"));
        assertThat(SqlCapture.QUERIES).anyMatch(sql -> sql.contains("where") && sql.contains("order by") && sql.contains("fetch first"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"page=-1", "page=bad", "size=0", "size=101", "status=OFFLINE", "sort=slots,asc", "sort=name,no",
            "sort=name,asc,extra", "sort=class", "sort=,asc"})
    void invalidQueryIs400(String query) throws Exception {
        var parts = query.split("=", -1);
        mvc.perform(admin(get("/api/v1/machines")).param(parts[0], parts[1])).andExpect(status().isBadRequest());
    }

    @Test
    void malformedBodiesAndLongSearchAre400() throws Exception {
        for (String input : List.of("{}", "null", "{", body("NEW").put("minTemperature", "invalid-number").toString())) {
            mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(input)).andExpect(status().isBadRequest());
            mvc.perform(admin(put("/api/v1/machines/" + campus.getId())).contentType("application/json").content(input)).andExpect(status().isBadRequest());
        }
        mvc.perform(admin(get("/api/v1/machines")).param("search", "a".repeat(201))).andExpect(status().isBadRequest());
    }

    @Test
    void realJwtRolesAreReloadedAndWritesDeniedBeforeValidation() throws Exception {
        for (String token : List.of("", staffToken)) {
            for (var request : List.of(get("/api/v1/machines"), get("/api/v1/machines/" + campus.getId()))) {
                if (!token.isEmpty()) request.header("Authorization", "Bearer " + token);
                mvc.perform(request).andExpect(status().is(token.isEmpty() ? 401 : 200));
            }
            for (var request : List.of(post("/api/v1/machines"), put("/api/v1/machines/" + campus.getId()),
                    patch("/api/v1/machines/" + campus.getId() + "/status"))) {
                if (!token.isEmpty()) request.header("Authorization", "Bearer " + token);
                mvc.perform(request.contentType("application/json").content("{")).andExpect(status().is(token.isEmpty() ? 401 : 403));
            }
        }
        jdbc.update("DELETE FROM user_roles WHERE user_id=?", adminId);
        mvc.perform(admin(get("/api/v1/machines"))).andExpect(status().isForbidden());
        mvc.perform(admin(post("/api/v1/machines")).contentType("application/json").content(body("DENIED").toString())).andExpect(status().isForbidden());
        jdbc.update("UPDATE users SET status='INACTIVE' WHERE id=?", adminId);
        mvc.perform(admin(get("/api/v1/machines"))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/machines").header("Authorization", "Bearer invalid-token")).andExpect(status().isUnauthorized());
        assertThat(machines.count()).isEqualTo(1);
    }

    @Test
    void concurrentConfigurationAndStatusUpdatesPreserveBothChanges() throws Exception {
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var profile = executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(put("/api/v1/machines/" + campus.getId())).contentType("application/json")
                        .content(updateBody().put("name", "Concurrent name").toString())).andReturn().getResponse().getStatus();
            });
            var state = executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(patch("/api/v1/machines/" + campus.getId() + "/status")).contentType("application/json")
                        .content("{\"status\":\"MAINTENANCE\"}")).andReturn().getResponse().getStatus();
            });
            assertThat(profile.get(20, TimeUnit.SECONDS)).isEqualTo(200);
            assertThat(state.get(20, TimeUnit.SECONDS)).isEqualTo(200);
        }
        var saved = machines.findById(campus.getId()).orElseThrow();
        assertThat(saved.getName()).isEqualTo("Concurrent name");
        assertThat(saved.getStatus()).isEqualTo(MachineStatus.MAINTENANCE);
        assertThat(saved.getHumidityMax()).isEqualByComparingTo("80.99");
    }

    @Test
    void configurationAndDeactivationPreserveRelatedRecordsAndHeartbeat() throws Exception {
        UUID slot = UUID.randomUUID(), product = UUID.randomUUID(), batch = UUID.randomUUID(), item = UUID.randomUUID(), order = UUID.randomUUID();
        jdbc.update("INSERT INTO machine_slots(id,machine_id,slot_code,capacity) VALUES (?,?,'A1',5)", slot, campus.getId());
        jdbc.update("INSERT INTO products(id,sku,name,price) VALUES (?,'FIXTURE','Fixture',1)", product);
        jdbc.update("INSERT INTO product_batches(id,batch_code,product_id,manufactured_at,expires_at,quantity) VALUES (?,'FIXTURE',?,now(),now()+interval '2 days',1)", batch, product);
        jdbc.update("INSERT INTO inventory_items(id,batch_id,slot_id,loaded_at) VALUES (?,?,?,now())", item, batch, slot);
        jdbc.update("INSERT INTO sensor_readings(machine_id,temperature,humidity,recorded_at) VALUES (?,5,60,now())", campus.getId());
        jdbc.update("INSERT INTO machine_events(machine_id,event_type,payload) VALUES (?,'FIXTURE','{}')", campus.getId());
        jdbc.update("INSERT INTO orders(id,order_code,machine_id,subtotal,total_amount) VALUES (?,'FIXTURE',?,1,1)", order, campus.getId());
        jdbc.update("INSERT INTO payments(order_id,provider,amount) VALUES (?,'TEST',1)", order);
        jdbc.update("INSERT INTO alerts(machine_id,type,severity,title,message,triggered_at) VALUES (?,'HIGH_TEMPERATURE','WARNING','Fixture','Fixture',now())", campus.getId());
        var tables = List.of("machine_slots", "products", "product_batches", "inventory_items", "sensor_readings", "machine_events", "orders", "payments", "alerts");
        var before = tables.stream().map(table -> jdbc.queryForList("SELECT * FROM " + table)).toList();
        mvc.perform(admin(put("/api/v1/machines/" + campus.getId())).contentType("application/json").content(updateBody().toString())).andExpect(status().isOk());
        mvc.perform(admin(patch("/api/v1/machines/" + campus.getId() + "/status")).contentType("application/json").content("{\"status\":\"INACTIVE\"}")).andExpect(status().isOk());
        for (int i = 0; i < tables.size(); i++) assertThat(jdbc.queryForList("SELECT * FROM " + tables.get(i))).isEqualTo(before.get(i));
        assertThat(machines.findById(campus.getId()).orElseThrow().getLastSeenAt()).isNull();
    }

    @Test
    @WithMockUser(roles = "ADMIN", setupBefore = org.springframework.security.test.context.support.TestExecutionEvent.TEST_EXECUTION)
    void serviceValidationAlsoProtectsNonMvcCalls() {
        assertThatThrownBy(() -> service.createMachine(new CreateMachineRequest("BAD", "Name", "Location", new BigDecimal("1.001"), BigDecimal.TEN, BigDecimal.ZERO, BigDecimal.TEN)))
                .isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThatThrownBy(() -> service.updateMachine(campus.getId(), new UpdateMachineRequest("Name", "Location", BigDecimal.ONE, BigDecimal.TEN, new BigDecimal("-1"), BigDecimal.TEN)))
                .isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThatThrownBy(() -> service.updateMachine(campus.getId(), new UpdateMachineRequest("Name", "Location", BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ZERO, BigDecimal.TEN)))
                .isInstanceOf(com.fruitmachine.backend.common.exception.BadRequestException.class);
        assertThatThrownBy(() -> service.updateStatus(campus.getId(), new UpdateMachineStatusRequest(null)))
                .isInstanceOf(jakarta.validation.ConstraintViolationException.class);
    }

    @Test
    @WithMockUser(roles = "STAFF", setupBefore = org.springframework.security.test.context.support.TestExecutionEvent.TEST_EXECUTION)
    void serviceWriteBoundaryRequiresAdmin() {
        assertThatThrownBy(() -> service.createMachine(new CreateMachineRequest("DENIED", "Name", "Location", BigDecimal.ONE, BigDecimal.TEN, BigDecimal.ZERO, BigDecimal.TEN)))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.updateMachine(campus.getId(), new UpdateMachineRequest("Name", "Location", BigDecimal.ONE, BigDecimal.TEN, BigDecimal.ZERO, BigDecimal.TEN)))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.updateStatus(campus.getId(), new UpdateMachineStatusRequest(MachineStatus.INACTIVE)))
                .isInstanceOf(AccessDeniedException.class);
    }
}
