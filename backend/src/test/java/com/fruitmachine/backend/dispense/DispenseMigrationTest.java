package com.fruitmachine.backend.dispense;

import com.fruitmachine.backend.support.TestPostgres;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static org.assertj.core.api.Assertions.*;

@Testcontainers
class DispenseMigrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = TestPostgres.create();

    @Test
    void upgradeFromV12KeepsExistingCommandsAndEnforcesNewUniquenessAndEvidenceChecks() throws Exception {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .target("12").load().migrate();
        UUID machine = UUID.randomUUID(), slot = UUID.randomUUID(), product = UUID.randomUUID(),
                batch = UUID.randomUUID(), bowl = UUID.randomUUID(), order = UUID.randomUUID();
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                var sql = connection.createStatement()) {
            sql.execute("INSERT INTO machines(id,code,name) VALUES ('" + machine + "','UPGRADE','Upgrade machine')");
            sql.execute("INSERT INTO machine_slots(id,machine_id,slot_code,capacity) VALUES ('" + slot + "','" + machine + "','A1',5)");
            sql.execute("INSERT INTO products(id,sku,name,price) VALUES ('" + product + "','UPGRADE','Bowl',35000)");
            sql.execute("INSERT INTO product_batches(id,batch_code,product_id,manufactured_at,expires_at,quantity) VALUES ('" + batch + "','UPGRADE','" + product + "',now()-interval '1 day',now()+interval '2 days',1)");
            sql.execute("INSERT INTO inventory_items(id,batch_id,slot_id,loaded_at) VALUES ('" + bowl + "','" + batch + "','" + slot + "',now())");
            sql.execute("INSERT INTO orders(id,order_code,machine_id,subtotal,total_amount) VALUES ('" + order + "','UPGRADE','" + machine + "',35000,35000)");
            String values = "'" + order + "','" + machine + "','" + slot + "','" + bowl + "'";
            sql.execute("INSERT INTO dispense_commands(command_code,order_id,machine_id,slot_id,inventory_item_id) VALUES ('UPGRADE'," + values + ")");
            Flyway upgraded = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()).load();
            assertThat(upgraded.migrate().migrationsExecuted).isEqualTo(1);
            assertThat(upgraded.validateWithResult().validationSuccessful).isTrue();
            try (var result = sql.executeQuery("SELECT status,dispatch_token,bowl_count_before,bowl_count_after FROM dispense_commands WHERE command_code='UPGRADE'")) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString(1)).isEqualTo("PENDING");
                assertThat(result.getObject(2)).isNull();
                assertThat(result.getObject(3)).isNull();
                assertThat(result.getObject(4)).isNull();
            }
            assertThatThrownBy(() -> sql.execute("INSERT INTO dispense_commands(command_code,order_id,machine_id,slot_id,inventory_item_id) VALUES ('DUPLICATE'," + values + ")"))
                    .isInstanceOf(SQLException.class).satisfies(ex -> assertThat(((SQLException) ex).getSQLState()).isEqualTo("23505"));
            assertThatThrownBy(() -> sql.execute("UPDATE dispense_commands SET bowl_count_before=1 WHERE command_code='UPGRADE'"))
                    .isInstanceOf(SQLException.class).satisfies(ex -> assertThat(((SQLException) ex).getSQLState()).isEqualTo("23514"));
        }
    }
}
