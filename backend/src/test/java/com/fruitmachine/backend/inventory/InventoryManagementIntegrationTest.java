package com.fruitmachine.backend.inventory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.inventory.dto.*;
import com.fruitmachine.backend.inventory.entity.*;
import com.fruitmachine.backend.inventory.enums.*;
import com.fruitmachine.backend.inventory.repository.*;
import com.fruitmachine.backend.inventory.service.InventoryService;
import com.fruitmachine.backend.machine.entity.*;
import com.fruitmachine.backend.machine.enums.*;
import com.fruitmachine.backend.machine.repository.*;
import com.fruitmachine.backend.product.entity.*;
import com.fruitmachine.backend.product.batch.repository.ProductBatchRepository;
import com.fruitmachine.backend.product.repository.ProductRepository;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
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

@SpringBootTest(properties = {"spring.config.import=", "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.fruitmachine.backend.inventory.InventoryManagementIntegrationTest$SqlCapture"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@Testcontainers
class InventoryManagementIntegrationTest {
    public static class SqlCapture implements org.hibernate.resource.jdbc.spi.StatementInspector {
        static final List<String> QUERIES = new CopyOnWriteArrayList<>();
        public String inspect(String sql) { QUERIES.add(sql); return sql; }
    }
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    static final String KEY = newKey(), PASSWORD = "Test-only-inventory-passphrase!", PATH = "/api/v1/inventory";
    static final Instant NOW = Instant.parse("2030-10-10T02:00:00Z");
    static String newKey() { byte[] bytes = new byte[32]; new java.security.SecureRandom().nextBytes(bytes); return Base64.getEncoder().encodeToString(bytes); }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl); registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword); registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-inventory@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired ProductRepository products;
    @Autowired ProductBatchRepository batches;
    @Autowired MachineRepository machines;
    @Autowired MachineSlotRepository slots;
    @Autowired InventoryItemRepository items;
    @MockitoSpyBean InventoryTransactionRepository history;
    @Autowired InventoryService service;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;
    @MockitoSpyBean Clock clock;
    String adminToken, staffToken, rolelessToken;
    UUID adminId, staffId;
    Product product;
    ProductBatch batch;
    Machine machine, otherMachine;
    MachineSlot slot, otherSlot;
    @BeforeEach void setup() throws Exception {
        // Append-only history is never erased: unique fixture roots isolate every test.
        doReturn(NOW).when(clock).instant();
        adminToken = login("ADMIN"); staffToken = login("STAFF"); rolelessToken = login("");
        product = product(); batch = batch(product, 12);
        machine = machine(); otherMachine = machine(); slot = slot(machine, 6); otherSlot = slot(otherMachine, 6);
    }
    String login(String role) throws Exception {
        var user = new User(); user.setEmail(UUID.randomUUID()+"@example.invalid"); user.setFullName("Inventory tester"); user.setPasswordHash(encoder.encode(PASSWORD)); users.saveAndFlush(user);
        if (!role.isEmpty()) jdbc.update("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?", user.getId(), role);
        if (role.equals("ADMIN")) adminId=user.getId(); if (role.equals("STAFF")) staffId=user.getId();
        var response=mvc.perform(post("/api/v1/auth/login").contentType("application/json").content(json.writeValueAsString(Map.of("email",user.getEmail(),"password",PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).at("/data/accessToken").asText();
    }
    Product product() { var p=new Product(); p.setSku(UUID.randomUUID().toString()); p.setName("Fruit Box"); p.setPrice(BigDecimal.ONE); return products.saveAndFlush(p); }
    ProductBatch batch(Product p,int quantity) { var b=new ProductBatch(); b.setBatchCode(UUID.randomUUID().toString()); b.setProduct(p); b.setManufacturedAt(NOW.minus(Duration.ofDays(1))); b.setExpiresAt(NOW.plus(Duration.ofDays(2))); b.setQuantity(quantity); return batches.saveAndFlush(b); }
    Machine machine() { var m=new Machine(); m.setCode(UUID.randomUUID().toString()); m.setName("Test Machine"); m.setStatus(MachineStatus.ACTIVE); return machines.saveAndFlush(m); }
    MachineSlot slot(Machine m,int capacity) { var s=new MachineSlot(); s.setMachine(m); s.setSlotCode("A1"); s.setCapacity(capacity); s.setStatus(SlotStatus.ACTIVE); return slots.saveAndFlush(s); }
    ObjectNode body(int quantity) { return json.createObjectNode().put("batchId",batch.getId().toString()).put("slotId",slot.getId().toString()).put("quantity",quantity); }
    MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request,String token) { return request.header("Authorization","Bearer "+token); }
    ObjectNode load(int quantity,String token) throws Exception { return (ObjectNode) json.readTree(mvc.perform(auth(post(PATH+"/load"),token).contentType("application/json").content(body(quantity).toString())).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).path("data"); }
    String scoped(Machine m,MachineSlot s) { return "/api/v1/machines/"+m.getId()+"/slots/"+s.getId()+"/inventory"; }
    ObjectNode summary() throws Exception { return (ObjectNode) json.readTree(mvc.perform(auth(get(scoped(machine,slot)+"/summary"),staffToken)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("data"); }
    long countItems() { return items.countByBatchId(batch.getId()); }
    long countHistory() { return jdbc.queryForObject("SELECT count(*) FROM inventory_transactions h JOIN inventory_items i ON i.id=h.inventory_item_id WHERE i.batch_id=?",Long.class,batch.getId()); }
    UUID fixture(InventoryStatus status,ProductBatch batch,MachineSlot slot) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO inventory_items(id,batch_id,slot_id,status,loaded_at,reserved_at,sold_at,removed_at) VALUES (?,?,?,?,?,?,?,?)",id,batch.getId(),slot==null?null:slot.getId(),status.name(),slot==null?null:java.sql.Timestamp.from(NOW),status==InventoryStatus.RESERVED?java.sql.Timestamp.from(NOW):null,status==InventoryStatus.SOLD?java.sql.Timestamp.from(NOW):null,status==InventoryStatus.REMOVED?java.sql.Timestamp.from(NOW):null);
        return id;
    }
    @Test void bothRolesLoadExactlyNItemsAndPerItemActorStatusLocationHistoryWithoutChangingBatch() throws Exception {
        for(String token:List.of(adminToken,staffToken)) {
            var result=load(2,token); UUID operation=UUID.fromString(result.path("operationId").asText());
            assertThat(result.path("items")).hasSize(2);
            var events=jdbc.queryForList("SELECT * FROM inventory_transactions WHERE reference_id=?",operation);
            assertThat(events).hasSize(2);
            for(var event:events) {
                assertThat(event.get("type")).isEqualTo("LOAD"); assertThat(event.get("performed_by")).isEqualTo(token.equals(adminToken)?adminId:staffId);
                assertThat(event.get("machine_id")).isEqualTo(machine.getId()); assertThat(event.get("slot_id")).isEqualTo(slot.getId());
                assertThat(event.get("status_before")).isNull(); assertThat(event.get("status_after")).isEqualTo("AVAILABLE");
            }
            for(var item:result.path("items")) {
                assertThat(item.path("status").asText()).isEqualTo("AVAILABLE"); assertThat(item.path("slotId").asText()).isEqualTo(slot.getId().toString());
                assertThat(item.path("loadedAt").asText()).isEqualTo(NOW.toString());
                assertThat(item.fieldNames()).toIterable().doesNotContain("batch","slot","passwordHash","allocations");
            }
        }
        assertThat(countItems()).isEqualTo(4); assertThat(countHistory()).isEqualTo(4);
        assertThat(batches.findById(batch.getId()).orElseThrow().getQuantity()).isEqualTo(12);
    }
    @ParameterizedTest @ValueSource(strings={"0","-1","1.5","6.0","\"2\"","true","1001","2147483648","null"})
    void invalidQuantityIs400WithoutPartialWrites(String value) throws Exception {
        var request=body(1); request.set("quantity",json.readTree(value));
        mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        assertThat(countItems()).isZero(); assertThat(countHistory()).isZero();
    }
    @ParameterizedTest @ValueSource(strings={"batchId","slotId","quantity"})
    void allRequiredLoadFieldsRejectMissingNullAndInvalidUuid(String field) throws Exception {
        var request=body(1); request.remove(field);
        mvc.perform(auth(post(PATH+"/load"),adminToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
        request.putNull(field); mvc.perform(auth(post(PATH+"/load"),adminToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
    }
    @ParameterizedTest @ValueSource(strings={"performedBy","userId","status","machineId","operationId"})
    void actorAndSystemFieldsCannotBeSpoofed(String field) throws Exception {
        var request=body(1).put(field,adminId.toString());
        mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(request.toString())).andExpect(status().isBadRequest());
    }
    @Test void missingBatchSlotAndInactiveExpiredStatesRejectWithoutWrites() throws Exception {
        for(String field:List.of("batchId","slotId")) mvc.perform(auth(post(PATH+"/load"),adminToken).contentType("application/json").content(body(1).put(field,UUID.randomUUID().toString()).toString())).andExpect(status().isNotFound());
        jdbc.update("UPDATE products SET status='INACTIVE' WHERE id=?",product.getId());
        mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(body(1).toString())).andExpect(status().isConflict());
        jdbc.update("UPDATE products SET status='ACTIVE' WHERE id=?",product.getId());
        jdbc.update("UPDATE product_batches SET expires_at=? WHERE id=?",java.sql.Timestamp.from(NOW),batch.getId());
        mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(body(1).toString())).andExpect(status().isConflict());
        assertThat(countItems()).isZero(); assertThat(countHistory()).isZero();
    }
    @Test void machineAndSlotLoadingPolicyDoesNotAutomaticallyActivateAnything() throws Exception {
        jdbc.update("UPDATE machines SET status='INACTIVE' WHERE id=?",machine.getId());
        mvc.perform(auth(post(PATH+"/load"),adminToken).contentType("application/json").content(body(1).toString())).andExpect(status().isConflict());
        jdbc.update("UPDATE machines SET status='MAINTENANCE' WHERE id=?",machine.getId()); load(1,staffToken);
        assertThat(summary().path("sellableCount").asLong()).isZero();
        assertThat(machines.findById(machine.getId()).orElseThrow().getStatus()).isEqualTo(MachineStatus.MAINTENANCE);
        for(String state:List.of("INACTIVE","ERROR")) { jdbc.update("UPDATE machine_slots SET status=? WHERE id=?",state,slot.getId()); mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(body(1).toString())).andExpect(status().isConflict()); }
    }
    @Test void queryPagesFiltersDetailsScopesAndExpiredAwarenessAvoidNPlusOne() throws Exception {
        var loaded=load(3,staffToken); String id=loaded.path("items").get(0).path("id").asText();
        var otherBatch=batch(product,3); fixture(InventoryStatus.AVAILABLE,otherBatch,otherSlot);
        for(String token:List.of(adminToken,staffToken)) {
            SqlCapture.QUERIES.clear();
            mvc.perform(auth(get(PATH),token).param("machineId",machine.getId().toString()).param("slotId",slot.getId().toString()).param("batchId",batch.getId().toString()).param("status","AVAILABLE").param("size","1"))
                    .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
                    .andExpect(jsonPath("$.data.totalElements").value(3)).andExpect(jsonPath("$.data.totalPages").value(3)).andExpect(jsonPath("$.data.content.length()").value(1));
            assertThat(SqlCapture.QUERIES).anyMatch(sql->sql.contains("inventory_items")&&sql.contains("fetch first"));
            assertThat(SqlCapture.QUERIES.stream().filter(sql->sql.startsWith("select")&&sql.contains("inventory_items")&&!sql.contains("count(")).count()).isEqualTo(1);
            mvc.perform(auth(get(PATH+"/"+id),token)).andExpect(status().isOk()).andExpect(jsonPath("$.data.productName").value("Fruit Box")).andExpect(jsonPath("$.data.machineId").value(machine.getId().toString()));
            mvc.perform(auth(get("/api/v1/machines/"+machine.getId()+"/inventory"),token)).andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3));
            mvc.perform(auth(get(scoped(machine,slot)),token)).andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3));
            mvc.perform(auth(get(scoped(otherMachine,slot)),token)).andExpect(status().isNotFound());
            mvc.perform(auth(get(scoped(otherMachine,slot)+"/summary"),token)).andExpect(status().isNotFound());
            mvc.perform(auth(get(PATH+"/"+UUID.randomUUID()),token)).andExpect(status().isNotFound());
        }
        mvc.perform(auth(get("/api/v1/machines/"+UUID.randomUUID()+"/inventory"),staffToken)).andExpect(status().isNotFound());
        mvc.perform(auth(get(PATH),staffToken).param("batchId",UUID.randomUUID().toString())).andExpect(status().isOk()).andExpect(jsonPath("$.data.content").isEmpty());
        mvc.perform(auth(get(PATH),staffToken).param("batchId",batch.getId().toString()).param("page","9")).andExpect(status().isOk()).andExpect(jsonPath("$.data.content").isEmpty());
        jdbc.update("UPDATE product_batches SET expires_at=? WHERE id=?",java.sql.Timestamp.from(NOW),batch.getId());
        mvc.perform(auth(get(PATH),staffToken).param("batchId",batch.getId().toString()).param("expired","true")).andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3)).andExpect(jsonPath("$.data.content[0].expired").value(true));
        mvc.perform(auth(get(PATH),staffToken).param("batchId",batch.getId().toString()).param("expired","false")).andExpect(status().isOk()).andExpect(jsonPath("$.data.content").isEmpty());
        var counts=summary(); assertThat(counts.path("occupiedCount").asLong()).isEqualTo(3); assertThat(counts.path("availableCount").asLong()).isZero(); assertThat(counts.path("sellableCount").asLong()).isZero(); assertThat(counts.path("expiredCount").asLong()).isEqualTo(3);
    }
    @Test void summarySeparatesAvailableSellableOccupancyExpiryAndEligibility() throws Exception {
        load(2,staffToken); fixture(InventoryStatus.RESERVED,batch,slot); fixture(InventoryStatus.DISPENSE_FAILED,batch,slot);
        var old=batch(product,4); jdbc.update("UPDATE product_batches SET expires_at=? WHERE id=?",java.sql.Timestamp.from(NOW),old.getId());
        fixture(InventoryStatus.AVAILABLE,old,slot); fixture(InventoryStatus.EXPIRED,old,slot); fixture(InventoryStatus.REMOVED,batch,slot); fixture(InventoryStatus.SOLD,batch,slot);
        var counts=summary(); assertThat(counts.path("occupiedCount").asLong()).isEqualTo(6); assertThat(counts.path("availableCount").asLong()).isEqualTo(2);
        assertThat(counts.path("expiredCount").asLong()).isEqualTo(2); assertThat(counts.path("reservedCount").asLong()).isEqualTo(1); assertThat(counts.path("remainingCapacity").asLong()).isZero(); assertThat(counts.path("sellableCount").asLong()).isEqualTo(2);
        jdbc.update("UPDATE products SET status='INACTIVE' WHERE id=?",product.getId()); assertThat(summary().path("sellableCount").asLong()).isZero(); assertThat(summary().path("availableCount").asLong()).isEqualTo(2);
        jdbc.update("UPDATE products SET status='ACTIVE' WHERE id=?",product.getId());
        jdbc.update("UPDATE machine_slots SET status='ERROR' WHERE id=?",slot.getId()); assertThat(summary().path("sellableCount").asLong()).isZero();
    }
    @ParameterizedTest @ValueSource(strings={"AVAILABLE","EXPIRED"})
    void bothRolesRemoveAllowedStatesAndRetainDetailedHistoryAndLocation(String value) throws Exception {
        UUID id=fixture(InventoryStatus.valueOf(value),batch,slot);
        String token=value.equals("AVAILABLE")?adminToken:staffToken;
        mvc.perform(auth(post(PATH+"/"+id+"/remove"),token).contentType("application/json").content("{\"reason\":\" Maintenance removal \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("REMOVED")).andExpect(jsonPath("$.data.slotId").value(slot.getId().toString())).andExpect(jsonPath("$.data.removedAt").value(NOW.toString()));
        var event=jdbc.queryForMap("SELECT * FROM inventory_transactions WHERE inventory_item_id=?",id);
        assertThat(event.get("reason")).isEqualTo("Maintenance removal"); assertThat(event.get("status_before")).isEqualTo(value); assertThat(event.get("status_after")).isEqualTo("REMOVED");
        assertThat(event.get("performed_by")).isEqualTo(value.equals("AVAILABLE")?adminId:staffId); assertThat(event.get("slot_id")).isEqualTo(slot.getId()); assertThat(event.get("machine_id")).isEqualTo(machine.getId());
        assertThat(summary().path("occupiedCount").asLong()).isZero(); assertThat(summary().path("remainingCapacity").asLong()).isEqualTo(6);
        assertThat(items.findById(id)).isPresent(); assertThat(countItems()).isEqualTo(1); assertThat(batch.getQuantity()).isEqualTo(12);
        mvc.perform(auth(post(PATH+"/"+id+"/remove"),token).contentType("application/json").content("{\"reason\":\"again\"}")).andExpect(status().isConflict()); assertThat(countHistory()).isEqualTo(1);
    }
    @ParameterizedTest @ValueSource(strings={"SOLD","REMOVED","RESERVED","DISPENSE_FAILED"})
    void forbiddenRemovalStatesDoNotReleaseCapacityOrAppendHistory(String value) throws Exception {
        UUID id=fixture(InventoryStatus.valueOf(value),batch,slot); var before=summary();
        mvc.perform(auth(post(PATH+"/"+id+"/remove"),staffToken).contentType("application/json").content("{\"reason\":\"test\"}")).andExpect(status().isConflict());
        assertThat(items.findById(id).orElseThrow().getStatus()).isEqualTo(InventoryStatus.valueOf(value)); assertThat(countHistory()).isZero(); assertThat(summary()).isEqualTo(before);
    }
    @Test void removalReasonRequiredBoundedAndUnknownActorRejected() throws Exception {
        UUID id=fixture(InventoryStatus.AVAILABLE,batch,slot);
        for(String body:List.of("{}","{\"reason\":null}","{\"reason\":\" \"}",json.writeValueAsString(Map.of("reason","X".repeat(501))),"{\"reason\":\"test\",\"userId\":\"spoof\"}"))
            mvc.perform(auth(post(PATH+"/"+id+"/remove"),staffToken).contentType("application/json").content(body)).andExpect(status().isBadRequest());
        mvc.perform(auth(post(PATH+"/"+UUID.randomUUID()+"/remove"),staffToken).contentType("application/json").content("{\"reason\":\"test\"}")).andExpect(status().isNotFound());
        assertThat(countHistory()).isZero();
    }
    @Test void failedHistoryWriteRollsBackItemsAndRemovalInSameTransaction() throws Exception {
        doThrow(new com.fruitmachine.backend.common.exception.ConflictException("Test-only history failure")).when(history).save(any(InventoryTransaction.class));
        mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(body(3).toString())).andExpect(status().isConflict());
        assertThat(countItems()).isZero(); assertThat(countHistory()).isZero();
        UUID id=fixture(InventoryStatus.AVAILABLE,batch,slot);
        mvc.perform(auth(post(PATH+"/"+id+"/remove"),staffToken).contentType("application/json").content("{\"reason\":\"test\"}")).andExpect(status().isConflict());
        assertThat(items.findById(id).orElseThrow().getStatus()).isEqualTo(InventoryStatus.AVAILABLE); assertThat(items.findById(id).orElseThrow().getRemovedAt()).isNull(); assertThat(countHistory()).isZero();
    }
    void race(ObjectNode first,ObjectNode second,int expectedItems) throws Exception {
        var start=new CyclicBarrier(2);
        try(var executor=Executors.newFixedThreadPool(2)) {
            var a=executor.submit(()->{start.await();return mvc.perform(auth(post(PATH+"/load"),adminToken).contentType("application/json").content(first.toString())).andReturn().getResponse().getStatus();});
            var b=executor.submit(()->{start.await();return mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(second.toString())).andReturn().getResponse().getStatus();});
            assertThat(List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder(201,409);
        }
        assertThat(countItems()).isEqualTo(expectedItems); assertThat(countHistory()).isEqualTo(expectedItems);
    }
    @Test void concurrentLoadsDifferentProductsCannotOverfillSameSlot() throws Exception {
        jdbc.update("UPDATE machine_slots SET capacity=2 WHERE id=?",slot.getId()); var other=batch(product(),4);
        var start=new CyclicBarrier(2);
        try(var executor=Executors.newFixedThreadPool(2)) {
            var a=executor.submit(()->{start.await();return mvc.perform(auth(post(PATH+"/load"),adminToken).contentType("application/json").content(body(2).toString())).andReturn().getResponse().getStatus();});
            var b=executor.submit(()->{start.await();return mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(body(2).put("batchId",other.getId().toString()).toString())).andReturn().getResponse().getStatus();});
            assertThat(List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder(201,409);
        }
        assertThat(summary().path("occupiedCount").asLong()).isEqualTo(2);
    }
    @Test void concurrentLoadsAcrossDifferentMachinesCannotExceedSameBatch() throws Exception {
        jdbc.update("UPDATE product_batches SET quantity=2 WHERE id=?",batch.getId()); race(body(2),body(2).put("slotId",otherSlot.getId().toString()),2);
    }
    @Test void concurrentDoubleRemovalProducesOnlyOneHistoryRow() throws Exception {
        UUID id=fixture(InventoryStatus.AVAILABLE,batch,slot);
        try(var executor=Executors.newFixedThreadPool(2)) {
            var start=new CyclicBarrier(2);
            java.util.concurrent.Callable<Integer> remove=()->{start.await(); return mvc.perform(auth(post(PATH+"/"+id+"/remove"),staffToken).contentType("application/json").content("{\"reason\":\"confirmed\"}")).andReturn().getResponse().getStatus();};
            var a=executor.submit(remove); var b=executor.submit(remove); assertThat(List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder(200,409);
        }
        assertThat(countHistory()).isEqualTo(1); assertThat(countItems()).isEqualTo(1);
    }
    @Test void historyPagesReferenceItemTypeLocationFiltersAndAppendOnlyProtection() throws Exception {
        var result=load(3,staffToken); String reference=result.path("operationId").asText(); String id=result.path("items").get(0).path("id").asText();
        for(String token:List.of(adminToken,staffToken)) {
            var response=mvc.perform(auth(get(PATH+"/transactions"),token).param("referenceId",reference).param("machineId",machine.getId().toString()).param("slotId",slot.getId().toString()).param("type","LOAD").param("size","1"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3)).andExpect(jsonPath("$.data.content.length()").value(1)).andExpect(jsonPath("$.data.content[0].performedBy").value(staffId.toString())).andReturn().getResponse().getContentAsString();
            assertThat(response).doesNotContain("passwordHash","userRoles","inventoryItem\"",KEY,PASSWORD);
            mvc.perform(auth(get(PATH+"/transactions"),token).param("inventoryItemId",id)).andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(1));
        }
        assertThatThrownBy(()->jdbc.update("UPDATE inventory_transactions SET reason='rewrite' WHERE reference_id=?",UUID.fromString(reference))).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("DELETE FROM inventory_transactions WHERE reference_id=?",UUID.fromString(reference))).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThat(countHistory()).isEqualTo(3);
    }
    @Test void currentJwtRolesAndAccountStatusGuardAllOperationsBeforeValidation() throws Exception {
        var result=load(1,staffToken); String id=result.path("items").get(0).path("id").asText();
        for(String path:List.of(PATH,PATH+"/"+id,PATH+"/transactions","/api/v1/machines/"+machine.getId()+"/inventory",scoped(machine,slot),scoped(machine,slot)+"/summary")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized()); mvc.perform(auth(get(path),"invalid")).andExpect(status().isUnauthorized()); mvc.perform(auth(get(path),rolelessToken)).andExpect(status().isForbidden());
        }
        for(String path:List.of(PATH+"/load",PATH+"/"+id+"/remove")) {
            mvc.perform(post(path).contentType("application/json").content("bad")).andExpect(status().isUnauthorized()); mvc.perform(auth(post(path),rolelessToken).contentType("application/json").content("bad")).andExpect(status().isForbidden());
        }
        jdbc.update("DELETE FROM user_roles WHERE user_id=?",staffId);
        mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content("bad")).andExpect(status().isForbidden());
        jdbc.update("UPDATE users SET status='INACTIVE' WHERE id=?",adminId); mvc.perform(auth(get(PATH),adminToken)).andExpect(status().isUnauthorized());
    }
    @Test void invalidQuerySortAndGenericStatusDeleteAreRejected() throws Exception {
        for(String[] query:List.of(new String[]{"page","-1"},new String[]{"size","0"},new String[]{"size","101"},new String[]{"status","INVALID"},new String[]{"slotId","bad"},new String[]{"expired","bad"},new String[]{"sort","batch.product.price"}))
            mvc.perform(auth(get(PATH),staffToken).param(query[0],query[1])).andExpect(status().isBadRequest());
        for(String sort:List.of("id","status","loadedAt","createdAt","updatedAt")) mvc.perform(auth(get(PATH),staffToken).param("sort",sort+",asc")).andExpect(status().isOk());
        UUID id=fixture(InventoryStatus.AVAILABLE,batch,slot);
        mvc.perform(auth(delete(PATH+"/"+id),staffToken)).andExpect(status().isMethodNotAllowed());
        mvc.perform(auth(patch(PATH+"/"+id),staffToken).contentType("application/json").content("{\"status\":\"SOLD\"}")).andExpect(status().isMethodNotAllowed());
        assertThat(items.findById(id).orElseThrow().getStatus()).isEqualTo(InventoryStatus.AVAILABLE);
    }
    @Test void emptySummaryAndLegacyOffMachineRowsRemainReadable() throws Exception {
        assertThat(summary().path("occupiedCount").asLong()).isZero(); assertThat(summary().path("remainingCapacity").asLong()).isEqualTo(6);
        UUID id=fixture(InventoryStatus.AVAILABLE,batch,null);
        mvc.perform(auth(get(PATH+"/"+id),staffToken)).andExpect(status().isOk()).andExpect(jsonPath("$.data.slotId").doesNotExist()).andExpect(jsonPath("$.data.machineId").doesNotExist());
        mvc.perform(auth(post(PATH+"/"+id+"/remove"),staffToken).contentType("application/json").content("{\"reason\":\"Stockroom removal\"}")).andExpect(status().isOk());
        var event=jdbc.queryForMap("SELECT machine_id,slot_id,reason FROM inventory_transactions WHERE inventory_item_id=?",id);
        assertThat(event.get("machine_id")).isNull(); assertThat(event.get("slot_id")).isNull(); assertThat(event.get("reason")).isEqualTo("Stockroom removal");
    }
    @Test void directServiceRoleGuardsAndRequestValidationRemainEnforced() {
        var context=org.springframework.security.core.context.SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new org.springframework.security.authentication.UsernamePasswordAuthenticationToken("roleless",null,List.of()));
        org.springframework.security.core.context.SecurityContextHolder.setContext(context);
        try {
            assertThatThrownBy(()->service.loadInventory(new LoadInventoryRequest(batch.getId(),slot.getId(),1))).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
            assertThatThrownBy(()->service.getInventorySummary(machine.getId(),slot.getId())).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
            var principal=new AuthenticatedUser(staffId,"test@example.invalid","",com.fruitmachine.backend.user.enums.UserStatus.ACTIVE,List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_STAFF")));
            context.setAuthentication(new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(principal,null,principal.getAuthorities()));
            assertThatThrownBy(()->service.loadInventory(new LoadInventoryRequest(batch.getId(),slot.getId(),0))).isInstanceOf(jakarta.validation.ConstraintViolationException.class);
            assertThatThrownBy(()->service.removeInventoryItem(UUID.randomUUID(),new RemoveInventoryRequest(" "))).isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        } finally { org.springframework.security.core.context.SecurityContextHolder.clearContext(); }
    }
    @Test void capacityIncludesAllPhysicalStatesButNotSoldOrRemovedAndBatchCountsAllRegistrations() throws Exception {
        for(var state:InventoryStatus.values()) fixture(state,batch,slot);
        assertThat(summary().path("occupiedCount").asLong()).isEqualTo(4);
        load(2,staffToken);
        mvc.perform(auth(post(PATH+"/load"),adminToken).contentType("application/json").content(body(1).toString())).andExpect(status().isConflict());
        jdbc.update("UPDATE product_batches SET quantity=8 WHERE id=?",batch.getId());
        mvc.perform(auth(post(PATH+"/load"),staffToken).contentType("application/json").content(body(1).put("slotId",otherSlot.getId().toString()).toString())).andExpect(status().isConflict());
        assertThat(countItems()).isEqualTo(8); assertThat(countHistory()).isEqualTo(2);
    }
}
