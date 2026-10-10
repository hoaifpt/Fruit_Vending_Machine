package com.fruitmachine.backend.integration;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.sql.SQLException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import static org.assertj.core.api.Assertions.*;

class CoreDatabaseIntegrationTest extends AbstractCoreIntegrationTest {
    @Test
    void flywayIsValidAndReapplyingMigrationsDoesNotChangeTheSchema() throws SQLException {
        flyway.validate();
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("9");
        assertThat(flyway.info().pending()).isEmpty();
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE success", Long.class)).isEqualTo(9);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'", Long.class)).isEqualTo(20);
        try (var connection = dataSource.getConnection()) {
            assertThat(connection.getMetaData().getURL()).isEqualTo(POSTGRES.getJdbcUrl());
        }
    }

    @Test
    void databaseRejectsUniqueForeignKeyAndCheckViolationsIndependentlyOfDtoValidation() throws Exception {
        var stock = fixtures.stock(4, 4, admin.token(), staff.token());
        reject("23505", "INSERT INTO products(sku,name,price) SELECT sku,'Duplicate',1 FROM products WHERE id='"+stock.productId()+"'");
        reject("23505", "INSERT INTO machines(code,name) SELECT code,'Duplicate' FROM machines WHERE id='"+stock.machineId()+"'");
        reject("23505", "INSERT INTO machine_slots(machine_id,slot_code,capacity) VALUES ('"+stock.machineId()+"','A1',1)");
        reject("23503", "INSERT INTO machine_slots(machine_id,slot_code,capacity) VALUES ('"+UUID.randomUUID()+"','A2',1)");
        reject("23503", "INSERT INTO inventory_items(batch_id) VALUES ('"+UUID.randomUUID()+"')");
        reject("23514", "UPDATE products SET price=-1 WHERE id='"+stock.productId()+"'");
        reject("23514", "UPDATE product_batches SET quantity=0 WHERE id='"+stock.batchId()+"'");
        reject("23514", "UPDATE machine_slots SET capacity=0 WHERE id='"+stock.slotId()+"'");
        assertThat(jdbc.queryForObject("SELECT quantity FROM product_batches WHERE id=?", Integer.class, stock.batchId())).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT capacity FROM machine_slots WHERE id=?", Integer.class, stock.slotId())).isEqualTo(4);
    }

    @Test
    void immutableHistoryAndReferencedInventorySurviveRejectedMutations() throws Exception {
        var stock = fixtures.stock(4, 4, admin.token(), staff.token());
        fixtures.load(stock, 1, staff.token());
        for (String statement : new String[]{"UPDATE inventory_transactions SET reason='changed'",
                "DELETE FROM inventory_transactions", "TRUNCATE inventory_transactions"}) reject("55000", statement);
        reject("23001", "DELETE FROM inventory_items WHERE batch_id='"+stock.batchId()+"'");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE batch_id=?", Long.class, stock.batchId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions WHERE machine_id=?", Long.class, stock.machineId())).isEqualTo(1);
    }

    private void reject(String sqlState, String statement) {
        assertThatThrownBy(() -> jdbc.execute(statement)).isInstanceOf(DataAccessException.class)
                .satisfies(error -> {
                    Throwable cause = error;
                    while (cause.getCause() != null) cause = cause.getCause();
                    assertThat(cause).isInstanceOf(SQLException.class);
                    assertThat(((SQLException) cause).getSQLState()).isEqualTo(sqlState);
                });
    }
}
