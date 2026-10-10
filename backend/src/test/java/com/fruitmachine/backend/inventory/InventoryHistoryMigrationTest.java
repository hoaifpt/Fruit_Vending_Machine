package com.fruitmachine.backend.inventory;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import static org.assertj.core.api.Assertions.*;

@Testcontainers
class InventoryHistoryMigrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    @Test void v8HistorySurvivesForwardUpgradeWithoutFabricatedDetailsOrLostAppendOnlyProtection() {
        var datasource=new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());
        var jdbc=new JdbcTemplate(datasource);
        Flyway.configure().dataSource(datasource).target("8").load().migrate();
        UUID product=UUID.randomUUID(),batch=UUID.randomUUID(),machine=UUID.randomUUID(),slot=UUID.randomUUID(),item=UUID.randomUUID(),history=UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,sku,name,price) VALUES (?,'LEGACY','Legacy',1)",product);
        jdbc.update("INSERT INTO product_batches(id,batch_code,product_id,manufactured_at,expires_at,quantity) VALUES (?,'LEGACY',?,now(),now()+interval '2 days',1)",batch,product);
        jdbc.update("INSERT INTO machines(id,code,name) VALUES (?,'LEGACY','Legacy')",machine);
        jdbc.update("INSERT INTO machine_slots(id,machine_id,slot_code,capacity) VALUES (?,?,'A1',6)",slot,machine);
        jdbc.update("INSERT INTO inventory_items(id,batch_id,slot_id,loaded_at) VALUES (?,?,?,now())",item,batch,slot);
        jdbc.update("INSERT INTO inventory_transactions(id,inventory_item_id,machine_id,slot_id,type) VALUES (?,?,?,?,'LOAD')",history,item,machine,slot);
        var before=jdbc.queryForMap("SELECT id,inventory_item_id,machine_id,slot_id,type,reference_id,performed_by,created_at FROM inventory_transactions WHERE id=?",history);
        var flyway=Flyway.configure().dataSource(datasource).load(); assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(jdbc.queryForMap("SELECT id,inventory_item_id,machine_id,slot_id,type,reference_id,performed_by,created_at FROM inventory_transactions WHERE id=?",history)).isEqualTo(before);
        var after=jdbc.queryForMap("SELECT reason,status_before,status_after FROM inventory_transactions WHERE id=?",history);
        assertThat(after.values()).containsOnlyNulls();
        assertThatThrownBy(()->jdbc.update("UPDATE inventory_transactions SET reason='changed' WHERE id=?",history)).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("DELETE FROM inventory_transactions WHERE id=?",history)).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(()->jdbc.execute("TRUNCATE inventory_transactions")).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO inventory_transactions(inventory_item_id,type,reason) VALUES (?,'REMOVE',' ')",item)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO inventory_transactions(inventory_item_id,type,status_after) VALUES (?,'REMOVE','INVALID')",item)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions",Integer.class)).isEqualTo(1);
    }
}
