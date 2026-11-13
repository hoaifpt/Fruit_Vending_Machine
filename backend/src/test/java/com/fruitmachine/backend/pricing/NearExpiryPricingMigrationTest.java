package com.fruitmachine.backend.pricing;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Issue #61 §11: V18 on a database that already has orders (backfill), and its refusal when an order was not charged its full price. */
@Testcontainers
class NearExpiryPricingMigrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();

    static String url(String schema) {
        String url = POSTGRES.getJdbcUrl();
        return url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema;
    }

    JdbcTemplate freshSchemaAtV17(String schema, DriverManagerDataSource datasource) {
        var jdbc = new JdbcTemplate(datasource);
        jdbc.execute("CREATE SCHEMA " + schema);
        Flyway.configure().dataSource(datasource).schemas(schema).target("17").load().migrate();
        return jdbc;
    }

    UUID order(JdbcTemplate jdbc, String subtotal, String total) {
        UUID machine = UUID.randomUUID(), product = UUID.randomUUID(), order = UUID.randomUUID();
        jdbc.update("INSERT INTO machines(id, code, name) VALUES (?, ?, 'Legacy')", machine, "LEGACY-" + machine);
        jdbc.update("INSERT INTO products(id, sku, name, price) VALUES (?, ?, 'Legacy', 35000)", product, "LEGACY-" + product);
        jdbc.update("INSERT INTO orders(id, order_code, machine_id, subtotal, total_amount) VALUES (?, ?, ?, ?, ?)", order, "ORD-LEGACY-" + order, machine,
                new java.math.BigDecimal(subtotal), new java.math.BigDecimal(total));
        jdbc.update("INSERT INTO order_items(order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, 1, ?, ?)", order, product,
                new java.math.BigDecimal(total), new java.math.BigDecimal(total));
        return order;
    }

    @Test
    void existingOrdersAreBackfilledAndTheSettingIsSeededOnce() {
        var datasource = new DriverManagerDataSource(url("v17ok"), POSTGRES.getUsername(), POSTGRES.getPassword());
        var jdbc = freshSchemaAtV17("v17ok", datasource);
        UUID legacy = order(jdbc, "35000", "35000");
        var flyway = Flyway.configure().dataSource(datasource).schemas("v17ok").load();
        assertThat(flyway.migrate().migrationsExecuted).isEqualTo(5);
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(jdbc.queryForMap("SELECT subtotal, discount_amount, total_amount FROM orders WHERE id = ?", legacy).values().stream().map(Object::toString))
                .containsExactly("35000.00", "0.00", "35000.00");
        assertThat(jdbc.queryForMap("SELECT original_unit_price, unit_price, discount_percent, discount_reason FROM order_items WHERE order_id = ?", legacy)
                .values().stream().map(Object::toString)).containsExactly("35000.00", "35000.00", "0", "NONE");
        assertThat(jdbc.queryForMap("SELECT count(*) AS rows, bool_and(near_expiry_enabled) AS enabled, min(near_expiry_percent) AS percent, "
                + "min(version) AS version, count(updated_by) AS actors FROM pricing_settings"))
                .containsEntry("rows", 1L).containsEntry("enabled", true).containsEntry("percent", 50).containsEntry("version", 0L).containsEntry("actors", 0L);
        assertThat(jdbc.queryForList("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id JOIN roles r ON r.id = rp.role_id "
                + "WHERE p.code LIKE 'PRICING_%' ORDER BY r.name, p.code", String.class)).containsExactly("PRICING_MANAGE", "PRICING_READ", "PRICING_READ");
    }

    @Test
    void anOrderNotChargedItsFullPriceStopsTheMigrationWithoutRewritingIt() {
        var datasource = new DriverManagerDataSource(url("v17bad"), POSTGRES.getUsername(), POSTGRES.getPassword());
        var jdbc = freshSchemaAtV17("v17bad", datasource);
        UUID odd = order(jdbc, "35000", "30000");
        var flyway = Flyway.configure().dataSource(datasource).schemas("v17bad").load();
        assertThatThrownBy(flyway::migrate).isInstanceOf(FlywayException.class).hasMessageContaining("total_amount <> subtotal");
        assertThat(jdbc.queryForObject("SELECT total_amount::text FROM orders WHERE id = ?", String.class, odd)).isEqualTo("30000.00");
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("17");
    }
}
