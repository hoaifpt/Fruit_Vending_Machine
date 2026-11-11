package com.fruitmachine.backend.machine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.machine.dto.slot.*;
import com.fruitmachine.backend.machine.entity.*;
import com.fruitmachine.backend.machine.enums.*;
import com.fruitmachine.backend.machine.repository.*;
import com.fruitmachine.backend.machine.service.MachineSlotService;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
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
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.config.import=",
        "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.fruitmachine.backend.machine.MachineSlotManagementIntegrationTest$SqlCapture"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@Testcontainers
class MachineSlotManagementIntegrationTest {
    public static class SqlCapture implements org.hibernate.resource.jdbc.spi.StatementInspector {
        static final List<String> QUERIES = new CopyOnWriteArrayList<>();
        public String inspect(String sql) { QUERIES.add(sql); return sql; }
    }
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    static final String KEY = MachineManagementIntegrationTest.newKey();
    static final String PASSWORD = "Test-only-slot-passphrase!";
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-slot@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired MachineRepository machines;
    @MockitoSpyBean MachineSlotRepository slots;
    @Autowired MachineSlotService service;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;
    String adminToken, staffToken;
    UUID adminId;
    Machine parent, other;
    MachineSlot a1;

    @BeforeEach
    void setup() throws Exception {
        // This container is isolated; no developer database/environment import.
        for (String table : List.of("dispense_commands", "order_items", "orders", "inventory_items", "product_batches",
                "products", "machine_slots", "machines", "user_roles", "users")) jdbc.update("DELETE FROM " + table);
        adminToken = login("ADMIN"); staffToken = login("STAFF");
        parent = machine("VM-A", MachineStatus.INACTIVE);
        other = machine("VM-B", MachineStatus.MAINTENANCE);
        a1 = slot(parent, "A1", 6, SlotStatus.ACTIVE);
    }
    String login(String role) throws Exception {
        var user = new User();
        user.setEmail(UUID.randomUUID() + "@example.invalid"); user.setFullName("Slot tester");
        user.setPasswordHash(encoder.encode(PASSWORD)); users.saveAndFlush(user);
        jdbc.update("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?", user.getId(), role);
        if (role.equals("ADMIN")) adminId = user.getId();
        var response = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(mapper.writeValueAsString(Map.of("email", user.getEmail(), "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(response).at("/data/accessToken").asText();
    }
    Machine machine(String code, MachineStatus status) {
        var result = new Machine(); result.setCode(code); result.setName(code); result.setStatus(status);
        return machines.saveAndFlush(result);
    }
    MachineSlot slot(Machine machine, String code, int capacity, SlotStatus status) {
        var result = new MachineSlot(); result.setMachine(machine); result.setSlotCode(code);
        result.setCapacity(capacity); result.setStatus(status); return slots.saveAndFlush(result);
    }
    String path(UUID machineId) { return "/api/v1/machines/" + machineId + "/slots"; }
    String path() { return path(parent.getId()); }
    String detail() { return path() + "/" + a1.getId(); }
    ObjectNode createBody(String code, int capacity) { return mapper.createObjectNode().put("slotCode", code).put("capacity", capacity); }
    MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder request) { return request.header("Authorization", "Bearer " + adminToken); }

    @Test
    void createNormalizesCodePersistsActiveAndReportsParentWithoutRecursiveEntities() throws Exception {
        var response = mvc.perform(admin(post(path())).contentType("application/json").content(createBody(" a2 ", 7).toString()))
                .andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.slotCode").value("A2")).andExpect(jsonPath("$.data.capacity").value(7))
                .andExpect(jsonPath("$.data.status").value("ACTIVE")).andExpect(jsonPath("$.data.machineId").value(parent.getId().toString()))
                .andReturn().getResponse();
        var data = mapper.readTree(response.getContentAsString()).path("data");
        assertThat(data.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "machineId", "slotCode", "capacity", "status", "createdAt", "updatedAt");
        UUID id = UUID.fromString(data.path("id").asText());
        assertThat(response.getHeader("Location")).isEqualTo(path() + "/" + id);
        var saved = slots.findById(id).orElseThrow();
        assertThat(saved.getMachineId()).isEqualTo(parent.getId());
        assertThat(saved.getSlotCode()).isEqualTo("A2");
        assertThat(saved.getCapacity()).isEqualTo(7);
        assertThat(saved.getStatus()).isEqualTo(SlotStatus.ACTIVE);
        assertThat(saved.getUpdatedAt()).isAfterOrEqualTo(saved.getCreatedAt());
        assertThat(data.path("createdAt").asText()).endsWith("Z");
    }

    @Test
    void duplicatesAreScopedAndConcurrentDatabaseUniquenessReturnsSafe409() throws Exception {
        mvc.perform(admin(post(path())).contentType("application/json").content(createBody(" a1 ", 6).toString()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("Slot code is already in use for this machine"));
        mvc.perform(admin(post(path(other.getId()))).contentType("application/json").content(createBody("a1", 6).toString()))
                .andExpect(status().isCreated());
        doReturn(false).when(slots).existsByMachineIdAndSlotCode(parent.getId(), "RACE");
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var jobs = java.util.stream.IntStream.range(0, 2).mapToObj(i -> executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(post(path())).contentType("application/json").content(createBody("race", 6).toString()))
                        .andReturn().getResponse();
            })).toList();
            var responses = List.of(jobs.get(0).get(20, TimeUnit.SECONDS), jobs.get(1).get(20, TimeUnit.SECONDS));
            assertThat(responses).extracting(r -> r.getStatus()).containsExactlyInAnyOrder(201, 409);
            assertThat(responses.stream().filter(r -> r.getStatus() == 409).findFirst().orElseThrow().getContentAsString())
                    .contains("Request conflicts with existing data").doesNotContain("duplicate key", "Hibernate", "SQL");
        }
        assertThat(slots.count()).isEqualTo(3);
    }

    @Test
    void allParentStatusesPermitProvisioningAndThereIsNoFixedSlotCountOrCapacity() throws Exception {
        for (var value : MachineStatus.values()) {
            jdbc.update("UPDATE machines SET status=? WHERE id=?", value.name(), parent.getId());
            mvc.perform(admin(post(path())).contentType("application/json").content(createBody("S-" + value, 1).toString()))
                    .andExpect(status().isCreated());
        }
        for (int i = 0; i < 3; i++) {
            mvc.perform(admin(post(path())).contentType("application/json").content(createBody("STACK-" + i, Integer.MAX_VALUE).toString()))
                    .andExpect(status().isCreated()).andExpect(jsonPath("$.data.capacity").value(Integer.MAX_VALUE));
        }
        assertThat(slots.findByMachineId(parent.getId(), org.springframework.data.domain.Pageable.unpaged()).getTotalElements()).isEqualTo(7);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "null", "1.5", "6.0", "2147483648", "\"6\"", "true", "{}", "[]", "\"bad\""})
    void invalidCapacityIs400OnCreateAndUpdateWithoutCoercion(String value) throws Exception {
        mvc.perform(admin(post(path())).contentType("application/json").content("{\"slotCode\":\"NEW\",\"capacity\":" + value + "}"))
                .andExpect(status().isBadRequest());
        mvc.perform(admin(put(detail())).contentType("application/json").content("{\"capacity\":" + value + "}"))
                .andExpect(status().isBadRequest());
        assertThat(slots.count()).isEqualTo(1);
        assertThat(slots.findById(a1.getId()).orElseThrow().getCapacity()).isEqualTo(6);
    }

    @Test
    void missingBlankOrOversizedCodeAndMissingCapacityReturn400() throws Exception {
        for (String value : List.of("", "   ", "A".repeat(33))) {
            mvc.perform(admin(post(path())).contentType("application/json").content(createBody(value, 6).toString())).andExpect(status().isBadRequest());
        }
        for (String input : List.of("{}", "null", "{", "{\"capacity\":6}", "{\"slotCode\":null,\"capacity\":6}", "{\"slotCode\":\"NEW\"}")) {
            mvc.perform(admin(post(path())).contentType("application/json").content(input)).andExpect(status().isBadRequest());
        }
        mvc.perform(admin(put(detail())).contentType("application/json").content("{}")).andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"id", "machineId", "status", "createdAt", "updatedAt", "productId", "batchId", "stock", "currentQuantity", "motorNumber", "GPIO"})
    void createUpdateAndStatusRejectImmutableOrUnrelatedFields(String field) throws Exception {
        mvc.perform(admin(post(path())).contentType("application/json").content(createBody("NEW", 6).put(field, "forbidden").toString()))
                .andExpect(status().isBadRequest());
        if (!field.equals("status")) {
            mvc.perform(admin(patch(detail() + "/status")).contentType("application/json")
                    .content(mapper.createObjectNode().put("status", "INACTIVE").put(field, "forbidden").toString())).andExpect(status().isBadRequest());
        }
        mvc.perform(admin(put(detail())).contentType("application/json").content(mapper.createObjectNode().put("capacity", 8).put(field, "forbidden").toString()))
                .andExpect(status().isBadRequest());
        assertThat(slots.findById(a1.getId()).orElseThrow().getCapacity()).isEqualTo(6);
    }

    @Test
    void capacityReplacementPreservesCodeParentStatusAndCreation() throws Exception {
        mvc.perform(admin(put(detail())).contentType("application/json").content("{\"capacity\":8}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.capacity").value(8)).andExpect(jsonPath("$.data.slotCode").value("A1"))
                .andExpect(jsonPath("$.data.machineId").value(parent.getId().toString())).andExpect(jsonPath("$.data.status").value("ACTIVE"));
        mvc.perform(admin(put(detail())).contentType("application/json").content("{\"capacity\":9,\"slotCode\":\"OTHER\"}")).andExpect(status().isBadRequest());
        var saved = slots.findById(a1.getId()).orElseThrow();
        assertThat(saved.getCapacity()).isEqualTo(8);
        assertThat(saved.getSlotCode()).isEqualTo("A1");
        assertThat(saved.getCreatedAt()).isEqualTo(a1.getCreatedAt());
        assertThat(saved.getUpdatedAt()).isAfterOrEqualTo(a1.getUpdatedAt());
    }

    @Test
    void statusesAndIdempotencePreserveParentAndCapacityWithoutDeletion() throws Exception {
        var machineBefore = jdbc.queryForMap("SELECT * FROM machines WHERE id=?", parent.getId());
        for (String value : List.of("INACTIVE", "ERROR", "ACTIVE", "ACTIVE", "INACTIVE")) {
            mvc.perform(admin(patch(detail() + "/status")).contentType("application/json").content("{\"status\":\"" + value + "\"}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value(value));
            var saved = slots.findById(a1.getId()).orElseThrow();
            assertThat(saved.getCapacity()).isEqualTo(6);
            assertThat(saved.getCreatedAt()).isEqualTo(a1.getCreatedAt());
            assertThat(jdbc.queryForMap("SELECT * FROM machines WHERE id=?", parent.getId())).isEqualTo(machineBefore);
        }
        mvc.perform(admin(delete(detail()))).andExpect(status().isMethodNotAllowed());
        assertThat(slots.findById(a1.getId())).isPresent();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"status\":null}", "{\"status\":\"MAINTENANCE\"}", "{\"status\":0}", "{\"status\":\"0\"}", "{\"status\":true}",
            "{\"status\":\"ACTIVE\",\"slotCode\":\"OTHER\"}", "null", "{"})
    void invalidStatusIs400IncludingEnumOrdinals(String input) throws Exception {
        mvc.perform(admin(patch(detail() + "/status")).contentType("application/json").content(input)).andExpect(status().isBadRequest());
    }

    @Test
    void missingParentSlotOrCrossMachineAccessAre404AndMalformedIds400() throws Exception {
        var before = jdbc.queryForList("SELECT * FROM machine_slots");
        for (String machineId : List.of(UUID.randomUUID().toString(), other.getId().toString())) {
            String scoped = "/api/v1/machines/" + machineId + "/slots/" + a1.getId();
            for (var request : List.of(get(scoped), put(scoped).contentType("application/json").content("{\"capacity\":8}"),
                    patch(scoped + "/status").contentType("application/json").content("{\"status\":\"ERROR\"}")))
                mvc.perform(admin(request)).andExpect(status().isNotFound());
        }
        String missingParent = path(UUID.randomUUID());
        mvc.perform(admin(get(missingParent))).andExpect(status().isNotFound()).andExpect(jsonPath("$.message").value("Machine not found"));
        mvc.perform(admin(post(missingParent)).contentType("application/json").content(createBody("NEW", 6).toString())).andExpect(status().isNotFound());
        for (String slotId : List.of(UUID.randomUUID().toString(), "bad-id")) {
            for (var request : List.of(get(path() + "/" + slotId), put(path() + "/" + slotId).contentType("application/json").content("{\"capacity\":8}"),
                    patch(path() + "/" + slotId + "/status").contentType("application/json").content("{\"status\":\"ERROR\"}")))
                mvc.perform(admin(request)).andExpect(status().is(slotId.equals("bad-id") ? 400 : 404));
        }
        mvc.perform(admin(get("/api/v1/machines/bad-id/slots"))).andExpect(status().isBadRequest());
        mvc.perform(admin(post("/api/v1/machines/bad-id/slots")).contentType("application/json").content(createBody("NEW", 6).toString())).andExpect(status().isBadRequest());
        assertThat(jdbc.queryForList("SELECT * FROM machine_slots")).isEqualTo(before);
    }

    @Test
    void readsAreMachineScopedDatabasePagesWithStatusFilterAndDeterministicSort() throws Exception {
        slot(parent, "A2", 8, SlotStatus.ERROR); slot(parent, "A3", 6, SlotStatus.INACTIVE);
        slot(other, "A1", 20, SlotStatus.ACTIVE);
        SqlCapture.QUERIES.clear();
        for (String token : List.of(adminToken, staffToken)) {
            var read = mvc.perform(get(detail()).header("Authorization", "Bearer " + token)).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            assertThat(mapper.readTree(read).path("data").fieldNames()).toIterable()
                    .containsExactlyInAnyOrder("id", "machineId", "slotCode", "capacity", "status", "createdAt", "updatedAt");
            var first = mvc.perform(get(path()).header("Authorization", "Bearer " + token).param("size", "2"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3)).andExpect(jsonPath("$.data.totalPages").value(2))
                    .andExpect(jsonPath("$.data.content[0].slotCode").value("A1")).andExpect(jsonPath("$.data.content[1].slotCode").value("A2"))
                    .andReturn().getResponse().getContentAsString();
            var second = mvc.perform(get(path()).header("Authorization", "Bearer " + token).param("size", "2").param("page", "1"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.content", hasSize(1))).andExpect(jsonPath("$.data.content[0].slotCode").value("A3"))
                    .andReturn().getResponse().getContentAsString();
            assertThat(mapper.readTree(first).at("/data/content").findValuesAsText("id"))
                    .doesNotContainAnyElementsOf(mapper.readTree(second).at("/data/content").findValuesAsText("id"));
            for (var value : SlotStatus.values())
                mvc.perform(get(path()).header("Authorization", "Bearer " + token).param("status", value.name()))
                        .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(1)).andExpect(jsonPath("$.data.content[0].status").value(value.name()));
        }
        mvc.perform(admin(get(path())).param("page", "999")).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content", hasSize(0))).andExpect(jsonPath("$.data.totalElements").value(3));
        var empty = machine("EMPTY", MachineStatus.ACTIVE);
        mvc.perform(admin(get(path(empty.getId())))).andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(0));
        for (String field : List.of("id", "slotCode", "capacity", "status", "createdAt", "updatedAt")) {
            String column = switch (field) { case "slotCode" -> "slot_code"; case "createdAt" -> "created_at"; case "updatedAt" -> "updated_at"; default -> field; };
            var response = mvc.perform(admin(get(path())).param("sort", field + ",desc")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            assertThat(mapper.readTree(response).at("/data/content").findValuesAsText("id")).isEqualTo(
                    jdbc.queryForList("SELECT id FROM machine_slots WHERE machine_id=? ORDER BY " + column + " DESC" + (field.equals("id") ? "" : ",id ASC"), UUID.class, parent.getId())
                            .stream().map(UUID::toString).toList());
        }
        var tie = mvc.perform(admin(get(path())).param("sort", "capacity")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(tie).at("/data/content").findValuesAsText("id")).isEqualTo(
                jdbc.queryForList("SELECT id FROM machine_slots WHERE machine_id=? ORDER BY capacity,id", UUID.class, parent.getId()).stream().map(UUID::toString).toList());
        assertThat(SqlCapture.QUERIES).anyMatch(sql -> sql.contains("from machine_slots") && sql.contains("where") && sql.contains("offset") && sql.contains("fetch first"));
        assertThat(SqlCapture.QUERIES).noneMatch(sql -> sql.contains("from inventory_items"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"page=-1", "page=bad", "size=0", "size=101", "status=MAINTENANCE", "sort=machine,asc", "sort=capacity,no", "sort=capacity,asc,extra", "sort=,asc"})
    void invalidListParametersAre400(String query) throws Exception {
        var parts = query.split("=", -1);
        mvc.perform(admin(get(path())).param(parts[0], parts[1])).andExpect(status().isBadRequest());
    }

    @Test
    void realJwtAccessMatrixAndCurrentDatabaseRolesProtectEveryEndpoint() throws Exception {
        for (String token : List.of("", staffToken)) {
            for (var read : List.of(get(path()), get(detail()))) {
                if (!token.isEmpty()) read.header("Authorization", "Bearer " + token);
                mvc.perform(read).andExpect(status().is(token.isEmpty() ? 401 : 200));
            }
            for (var write : List.of(post(path()), put(detail()), patch(detail() + "/status"))) {
                if (!token.isEmpty()) write.header("Authorization", "Bearer " + token);
                mvc.perform(write.contentType("application/json").content("{")).andExpect(status().is(token.isEmpty() ? 401 : 403));
            }
        }
        jdbc.update("DELETE FROM user_roles WHERE user_id=?", adminId);
        mvc.perform(admin(get(path()))).andExpect(status().isForbidden());
        mvc.perform(admin(post(path())).contentType("application/json").content(createBody("DENIED", 6).toString())).andExpect(status().isForbidden());
        jdbc.update("UPDATE users SET status='INACTIVE' WHERE id=?", adminId);
        mvc.perform(admin(get(path()))).andExpect(status().isUnauthorized());
        mvc.perform(get(path()).header("Authorization", "Bearer invalid-token")).andExpect(status().isUnauthorized());
    }

    @Test
    void concurrentCapacityAndStatusUpdatesPreserveBothFields() throws Exception {
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var capacity = executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(put(detail())).contentType("application/json").content("{\"capacity\":8}")).andReturn().getResponse().getStatus();
            });
            var state = executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(admin(patch(detail() + "/status")).contentType("application/json").content("{\"status\":\"ERROR\"}")).andReturn().getResponse().getStatus();
            });
            assertThat(capacity.get(20, TimeUnit.SECONDS)).isEqualTo(200);
            assertThat(state.get(20, TimeUnit.SECONDS)).isEqualTo(200);
        }
        var saved = slots.findById(a1.getId()).orElseThrow();
        assertThat(saved.getCapacity()).isEqualTo(8); assertThat(saved.getStatus()).isEqualTo(SlotStatus.ERROR);
    }

    @Test
    void capacityAndDeactivationPreserveInventoryAndDispenseHistoryFixtures() throws Exception {
        UUID product = UUID.randomUUID(), batch = UUID.randomUUID(), inventory = UUID.randomUUID(), order = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,sku,name,price) VALUES (?,'FIXTURE','Fixture',1)", product);
        jdbc.update("INSERT INTO product_batches(id,batch_code,product_id,manufactured_at,expires_at,quantity) VALUES (?,'FIXTURE',?,now(),now()+interval '2 days',1)", batch, product);
        jdbc.update("INSERT INTO inventory_items(id,batch_id,slot_id,loaded_at) VALUES (?,?,?,now())", inventory, batch, a1.getId());
        jdbc.update("INSERT INTO orders(id,order_code,machine_id,subtotal,total_amount) VALUES (?,'FIXTURE',?,1,1)", order, parent.getId());
        jdbc.update("INSERT INTO dispense_commands(command_code,order_id,machine_id,slot_id,inventory_item_id) VALUES ('FIXTURE',?,?,?,?)", order, parent.getId(), a1.getId(), inventory);
        var tables = List.of("machines", "products", "product_batches", "inventory_items", "orders", "dispense_commands");
        var before = tables.stream().map(table -> jdbc.queryForList("SELECT * FROM " + table)).toList();
        mvc.perform(admin(put(detail())).contentType("application/json").content("{\"capacity\":8}")).andExpect(status().isOk());
        mvc.perform(admin(patch(detail() + "/status")).contentType("application/json").content("{\"status\":\"INACTIVE\"}")).andExpect(status().isOk());
        for (int i = 0; i < tables.size(); i++) assertThat(jdbc.queryForList("SELECT * FROM " + tables.get(i))).isEqualTo(before.get(i));
        mvc.perform(admin(delete(detail()))).andExpect(status().isMethodNotAllowed());
        assertThat(slots.findById(a1.getId())).isPresent();
    }

    @Test
    @WithMockUser(roles = "ADMIN", setupBefore = org.springframework.security.test.context.support.TestExecutionEvent.TEST_EXECUTION)
    void serviceValidatesRequestsOutsideMvc() {
        assertThatThrownBy(() -> service.createSlot(parent.getId(), new CreateMachineSlotRequest("BAD", 0))).isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThatThrownBy(() -> service.updateSlot(parent.getId(), a1.getId(), new UpdateMachineSlotRequest(-1))).isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThatThrownBy(() -> service.updateStatus(parent.getId(), a1.getId(), new UpdateMachineSlotStatusRequest(null))).isInstanceOf(jakarta.validation.ConstraintViolationException.class);
    }

    @Test
    @WithMockUser(roles = "STAFF", setupBefore = org.springframework.security.test.context.support.TestExecutionEvent.TEST_EXECUTION)
    void serviceWritesRequireAdminOutsideController() {
        assertThatThrownBy(() -> service.createSlot(parent.getId(), new CreateMachineSlotRequest("DENIED", 6))).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.updateSlot(parent.getId(), a1.getId(), new UpdateMachineSlotRequest(8))).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.updateStatus(parent.getId(), a1.getId(), new UpdateMachineSlotStatusRequest(SlotStatus.INACTIVE))).isInstanceOf(AccessDeniedException.class);
    }
}
