package com.fruitmachine.backend.persistence;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.persistence.entity.*;
import com.fruitmachine.backend.persistence.enums.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.hibernate.SessionFactory;
import org.hibernate.cfg.Configuration;
import org.hibernate.engine.spi.SessionFactoryImplementor;
import org.hibernate.persister.entity.AbstractEntityPersister;
import org.hibernate.tool.schema.spi.SchemaManagementException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = "spring.config.import=", webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class EntityMappingTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired EntityManager entityManager;
    @Autowired EntityManagerFactory entityManagerFactory;
    @Autowired JdbcTemplate jdbc;
    @Autowired Environment environment;
    @Autowired TestRestTemplate http;
    @Autowired ObjectMapper objectMapper;
    @Autowired Flyway flyway;

    @Test
    void healthChecksRealDatabaseWithoutExposingConfiguration() throws Exception {
        assertThat(jdbc.queryForObject("SELECT 1", Integer.class)).isEqualTo(1);
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        var health = http.getForEntity("/actuator/health", String.class);
        assertThat(health.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(objectMapper.readTree(health.getBody()))
                .isEqualTo(JsonNodeFactory.instance.objectNode().put("status", "UP"));
        assertThat(http.getForEntity("/actuator/env", String.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(http.getForEntity("/actuator/configprops", String.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void validatesFlywaySchemaAndMapsEveryBusinessTableAndColumn() {
        assertThat(environment.getProperty("spring.jpa.hibernate.ddl-auto")).isEqualTo("validate");
        assertThat(environment.getProperty("spring.jpa.generate-ddl")).isEqualTo("false");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE success", Integer.class))
                .isEqualTo(8);

        var entities = entityManagerFactory.getMetamodel().getEntities();
        assertThat(entities).hasSize(19);
        Set<String> tables = jdbc.queryForList("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                AND table_name <> 'flyway_schema_history'
                """, String.class).stream().collect(Collectors.toSet());
        assertThat(entities.stream().map(e -> e.getJavaType().getAnnotation(Table.class).name())
                .collect(Collectors.toSet())).isEqualTo(tables);

        var sessionFactory = entityManagerFactory.unwrap(SessionFactoryImplementor.class);
        for (var entity : entities) {
            String table = entity.getJavaType().getAnnotation(Table.class).name();
            var persister = (AbstractEntityPersister) sessionFactory.getMappingMetamodel()
                    .getEntityDescriptor(entity.getJavaType());
            Set<String> mappedColumns = new HashSet<>(Arrays.asList(persister.getIdentifierColumnNames()));
            for (String property : persister.getPropertyNames()) {
                mappedColumns.addAll(Arrays.asList(persister.getPropertyColumnNames(property)));
            }
            Set<String> databaseColumns = new HashSet<>(jdbc.queryForList("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = ?
                    """, String.class, table));
            assertThat(mappedColumns).as("All columns of %s", table).isEqualTo(databaseColumns);
        }
    }

    @Test
    @Transactional
    void persistsAndReloadsAllEntitiesIncludingCompositeKeysJsonAndHistory() {
        User user = new User();
        user.setEmail("entity-test@example.com");
        // Opaque fixture hash; this test does not implement password authentication.
        user.setPasswordHash("$2a$10$fixtureHashOnlyNotAnActualLoginCredential");
        user.setFullName("Entity mapping test");
        entityManager.persist(user);
        Role admin = entityManager.createQuery("select r from Role r where r.name = :name", Role.class)
                .setParameter("name", "ADMIN").getSingleResult();
        UserRole membership = new UserRole();
        membership.setUser(user);
        membership.setRole(admin);
        entityManager.persist(membership);

        Machine machine = new Machine();
        machine.setCode("ENTITY-TEST");
        machine.setName("Entity test machine");
        entityManager.persist(machine);
        MachineSlot slot = new MachineSlot();
        slot.setMachine(machine);
        slot.setSlotCode("A1");
        slot.setCapacity(10);
        entityManager.persist(slot);

        Product product = new Product();
        product.setSku("ENTITY-TEST");
        product.setName("Fruit bowl");
        product.setDescription("PostgreSQL text mapping");
        product.setPrice(new BigDecimal("35000.00"));
        entityManager.persist(product);
        ProductBatch batch = new ProductBatch();
        batch.setBatchCode("ENTITY-TEST");
        batch.setProduct(product);
        batch.setQuantity(2);
        batch.setManufacturedAt(Instant.now().minus(1, ChronoUnit.HOURS));
        batch.setExpiresAt(Instant.now().plus(1, ChronoUnit.DAYS));
        batch.setCreatedBy(user);
        entityManager.persist(batch);
        InventoryItem bowl = new InventoryItem();
        bowl.setBatch(batch);
        bowl.setSlot(slot);
        bowl.setLoadedAt(Instant.now());
        entityManager.persist(bowl);
        InventoryItem warehouseBowl = new InventoryItem();
        warehouseBowl.setBatch(batch);
        entityManager.persist(warehouseBowl);

        SensorReading reading = new SensorReading();
        reading.setMachine(machine);
        reading.setTemperature(new BigDecimal("4.25"));
        reading.setHumidity(new BigDecimal("65.50"));
        reading.setRecordedAt(Instant.now().minus(10, ChronoUnit.MINUTES).truncatedTo(ChronoUnit.MICROS));
        entityManager.persist(reading);
        Alert alert = new Alert();
        alert.setMachine(machine);
        alert.setType(AlertType.LOW_STOCK);
        alert.setSeverity(AlertSeverity.WARNING);
        alert.setTitle("Low stock");
        entityManager.persist(alert);

        Order order = new Order();
        order.setOrderCode("ENTITY-TEST");
        order.setMachine(machine);
        order.setSubtotal(new BigDecimal("70000.00"));
        order.setTotalAmount(new BigDecimal("70000.00"));
        entityManager.persist(order);
        OrderItem line = new OrderItem();
        line.setOrder(order);
        line.setProduct(product);
        line.setQuantity(2);
        line.setUnitPrice(new BigDecimal("35000.00"));
        line.setTotalPrice(new BigDecimal("70000.00"));
        entityManager.persist(line);
        OrderItemAllocation allocation = new OrderItemAllocation();
        allocation.setOrderItem(line);
        allocation.setInventoryItem(bowl);
        entityManager.persist(allocation);
        for (int attempt = 0; attempt < 2; attempt++) {
            Payment payment = new Payment();
            payment.setOrder(order);
            payment.setProvider("PAYOS");
            payment.setAmount(new BigDecimal("70000.00"));
            payment.setQrCode("https://example.invalid/qr");
            entityManager.persist(payment);
        }
        PaymentWebhookLog webhook = new PaymentWebhookLog();
        webhook.setProvider("PAYOS");
        webhook.setOrderCode("UNRECOGNIZED-ORDER");
        webhook.setRawBody("{\"amount\":70000}");
        webhook.setRawPayload(JsonNodeFactory.instance.objectNode().put("amount", 70000));
        webhook.setSignature("fixture-signature");
        entityManager.persist(webhook);

        // Flush referenced rows before composite-key associations are loaded.
        entityManager.flush();
        DispenseCommand command = new DispenseCommand();
        command.setCommandCode("ENTITY-TEST");
        command.setOrderId(order.getId());
        command.setMachineId(machine.getId());
        command.setSlotId(slot.getId());
        command.setInventoryItemId(bowl.getId());
        entityManager.persist(command);
        InventoryTransaction history = new InventoryTransaction();
        history.setInventoryItem(bowl);
        history.setMachineId(machine.getId());
        history.setSlotId(slot.getId());
        history.setType(InventoryTransactionType.LOAD);
        history.setPerformedBy(user);
        entityManager.persist(history);
        InventoryTransaction warehouseHistory = new InventoryTransaction();
        warehouseHistory.setInventoryItem(warehouseBowl);
        warehouseHistory.setType(InventoryTransactionType.ADJUSTMENT);
        entityManager.persist(warehouseHistory);
        MachineEvent event = new MachineEvent();
        event.setMachine(machine);
        event.setEventType("BOOT");
        event.setPayload(JsonNodeFactory.instance.objectNode().put("firmware", "test"));
        entityManager.persist(event);
        AuditLog audit = new AuditLog();
        audit.setUser(user);
        audit.setAction("ENTITY_TEST");
        audit.setEntityType("machine");
        audit.setEntityId(machine.getId());
        audit.setNewValue(JsonNodeFactory.instance.objectNode().put("status", "ACTIVE"));
        entityManager.persist(audit);
        entityManager.flush();

        assertThat(user.getCreatedAt()).isNotNull();
        assertThat(user.getUpdatedAt()).isNotNull();
        assertThat(webhook.getReceivedAt()).isNotNull();
        assertThat(reading.getId()).isPositive();
        UUID commandId = command.getId();
        UUID historyId = history.getId();
        UserRoleId membershipId = membership.getId();
        Instant recordedAt = reading.getRecordedAt();
        entityManager.clear();

        DispenseCommand loaded = entityManager.find(DispenseCommand.class, commandId);
        assertThat(loaded.getOrder().getMachine().getId()).isEqualTo(machine.getId());
        assertThat(loaded.getSlot().getId()).isEqualTo(slot.getId());
        assertThat(loaded.getMachine().getId()).isEqualTo(machine.getId());
        assertThat(loaded.getInventoryItem().getBatch().getProduct().getId()).isEqualTo(product.getId());
        assertThat(loaded.getStatus()).isEqualTo(DispenseStatus.PENDING);
        assertThat(entityManager.find(UserRole.class, membershipId).getRole().getName()).isEqualTo("ADMIN");
        assertThat(entityManager.find(User.class, user.getId()).getRoleMemberships()).hasSize(1);
        assertThat(entityManager.find(Order.class, order.getId()).getItems()).hasSize(1);
        assertThat(entityManager.find(Order.class, order.getId()).getPayments()).hasSize(2);
        assertThat(entityManager.find(OrderItem.class, line.getId()).getAllocations()).hasSize(1);
        assertThat(entityManager.find(PaymentWebhookLog.class, webhook.getId()).getRawPayload().get("amount").asInt()).isEqualTo(70000);
        assertThat(entityManager.find(MachineEvent.class, event.getId()).getPayload().get("firmware").asText()).isEqualTo("test");
        assertThat(entityManager.find(AuditLog.class, audit.getId()).getNewValue().get("status").asText()).isEqualTo("ACTIVE");
        assertThat(entityManager.find(SensorReading.class, reading.getId()).getRecordedAt()).isEqualTo(recordedAt);
        assertThat(entityManager.find(InventoryItem.class, warehouseBowl.getId()).getSlot()).isNull();
        assertThat(entityManager.find(InventoryTransaction.class, warehouseHistory.getId()).getSlot()).isNull();
        InventoryTransaction loadedHistory = entityManager.find(InventoryTransaction.class, historyId);
        assertThat(loadedHistory.getSlot().getMachine().getId()).isEqualTo(machine.getId());
        // @Immutable must not emit UPDATE; the database trigger is a second line of protection.
        loadedHistory.setType(InventoryTransactionType.ADJUSTMENT);
        entityManager.flush();
        assertThat(jdbc.queryForObject("SELECT type FROM inventory_transactions WHERE id = ?", String.class, historyId))
                .isEqualTo("LOAD");
        Product loadedProduct = entityManager.find(Product.class, product.getId());
        Instant beforeUpdate = loadedProduct.getUpdatedAt();
        Instant originalCreatedAt = loadedProduct.getCreatedAt();
        loadedProduct.setPrice(new BigDecimal("40000.00"));
        entityManager.flush();
        assertThat(loadedProduct.getUpdatedAt()).isAfter(beforeUpdate);
        Instant auditedUpdate = loadedProduct.getUpdatedAt();
        entityManager.refresh(loadedProduct);
        assertThat(loadedProduct.getCreatedAt()).isEqualTo(originalCreatedAt);
        assertThat(loadedProduct.getUpdatedAt()).isEqualTo(auditedUpdate);
        assertThat(entityManager.find(OrderItem.class, line.getId()).getUnitPrice()).isEqualByComparingTo("35000.00");
    }

    @Test
    void validationRejectsMissingColumnAndDoesNotRepairSchema() {
        String schema = "mapping_validation_probe";
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas(schema).defaultSchema(schema).locations("classpath:db/migration").load().migrate();
        jdbc.execute("ALTER TABLE mapping_validation_probe.products DROP COLUMN image_url");
        Configuration config = new Configuration();
        entityManagerFactory.getMetamodel().getEntities().forEach(e -> config.addAnnotatedClass(e.getJavaType()));
        config.setProperty("hibernate.connection.url", POSTGRES.getJdbcUrl());
        config.setProperty("hibernate.connection.username", POSTGRES.getUsername());
        config.setProperty("hibernate.connection.password", POSTGRES.getPassword());
        config.setProperty("hibernate.hbm2ddl.auto", "validate");
        config.setProperty("hibernate.default_schema", schema);
        assertThatThrownBy(() -> {
            try (SessionFactory ignored = config.buildSessionFactory()) {
                throw new AssertionError("Schema validation unexpectedly passed");
            }
        }).isInstanceOf(SchemaManagementException.class).hasMessageContaining("image_url");
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = ? AND table_name = 'products' AND column_name = 'image_url'
                """, Integer.class, schema)).isZero();
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'image_url'
                """, Integer.class)).isEqualTo(1);
    }
}
