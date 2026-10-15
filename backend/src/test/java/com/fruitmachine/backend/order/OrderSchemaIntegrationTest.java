package com.fruitmachine.backend.order;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OrderSchemaIntegrationTest extends AbstractCoreIntegrationTest {
    // SHA-256 of V1-V9 with line endings normalized to LF, recorded from the dev branch before issue 27.
    private static final Map<String, String> APPLIED = Map.of(
            "V1__create_user_and_role_tables.sql", "b7f7a88c54e3cd274404e52ff08ff5b338d7b1cecd89f0ca357fb36a5a7423c0",
            "V2__create_machine_tables.sql", "478fdea48fc67d53767aa13c4f3eb38fcff6ce286a517428e2de511f05f5f5a3",
            "V3__create_product_and_inventory_tables.sql", "06b78045d6c0bb7dcb6f26763255f850609996a1b1f8814ecdac633ecc411899",
            "V4__create_sensor_and_alert_tables.sql", "b657f781769a1aa3fba4eb0725771cf5d0dac284bfd6b301d9adc5961e069b52",
            "V5__create_order_and_payment_tables.sql", "da4397db3a9c38053c2951a00fcb543299c78ce255f9b27da903724e27e35c47",
            "V6__create_dispense_and_event_tables.sql", "10d9cc977f0f8c594400373d615b7b7b3f9eab52bf3b2d0da62e9c07765309b9",
            "V7__create_indexes.sql", "93df38d7a541567ab0e67bbb774514de13c422669c6bc2a2cbbd920b88411126",
            "V8__seed_roles.sql", "8c2cb41753e862a6a8323ab39abe3a934173b3129f2e14f75c0cbf766eb350c0",
            "V9__add_inventory_history_details.sql", "96babce123212ff7a6c9a7d46c6d0b1fa7961df32e538007aac5b1aac7179aac");

    @Test
    void migrationsV10AndV11ApplyOnACleanDatabaseAndEarlierMigrationsAreUnchanged() throws Exception {
        flyway.validate();
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("11");
        assertThat(jdbc.queryForList("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank", String.class))
                .containsExactly("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11");
        for (var entry : APPLIED.entrySet()) {
            String text = Files.readString(Path.of("src/main/resources/db/migration", entry.getKey()), StandardCharsets.UTF_8).replace("\r\n", "\n");
            String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
            assertThat(digest).as(entry.getKey()).isEqualTo(entry.getValue());
        }
        assertThat(jdbc.queryForObject("SELECT is_nullable FROM information_schema.columns WHERE table_name='orders' AND column_name='expires_at'", String.class)).isEqualTo("YES");
    }

    @Test
    void partialUniqueIndexRejectsTwoActiveCredentialsForOneMachineButAllowsRevokedHistory() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String hash = "a".repeat(64);
        jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash) VALUES (?, 'aaaaaaaaaaaa', ?)", machine, hash);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash) VALUES (?, 'bbbbbbbbbbbb', ?)", machine, hash))
                .isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("uq_kiosk_credentials_active_machine");
        jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash, status, revoked_at) VALUES (?, 'cccccccccccc', ?, 'REVOKED', now())", machine, hash);
        jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash, status, revoked_at) VALUES (?, 'dddddddddddd', ?, 'REVOKED', now())", machine, hash);
        UUID other = fixtures.machine(admin.token());
        jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash) VALUES (?, 'eeeeeeeeeeee', ?)", other, hash);
    }

    @Test
    void credentialConstraintsRejectPlaintextLookingHashesBadPrefixesAndInconsistentRevocation() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        assertThatThrownBy(() -> jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash) VALUES (?, 'ffffffffffff', 'plaintext-secret')", machine))
                .hasMessageContaining("ck_kiosk_credentials_hash");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash) VALUES (?, 'UPPER', ?)", machine, "b".repeat(64)))
                .hasMessageContaining("ck_kiosk_credentials_prefix");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash, status) VALUES (?, 'gggggggggggg', ?, 'REVOKED')", machine, "b".repeat(64)))
                .hasMessageContaining("ck_kiosk_credentials_revoked");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash, status) VALUES (?, 'hhhhhhhhhhhh', ?, 'SUSPENDED')", machine, "b".repeat(64)))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO kiosk_credentials(machine_id, key_prefix, secret_hash) VALUES (?, 'iiiiiiiiiiii', ?)", UUID.randomUUID(), "b".repeat(64)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void ordersRejectAnExpiryThatIsNotAfterCreation() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        jdbc.update("INSERT INTO orders(order_code, machine_id, subtotal, total_amount) VALUES ('ORD-NULL-EXPIRY', ?, 0, 0)", machine);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO orders(order_code, machine_id, subtotal, total_amount, created_at, expires_at) VALUES ('ORD-EQUAL', ?, 0, 0, now(), now())", machine))
                .hasMessageContaining("ck_orders_expires_at");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO orders(order_code, machine_id, subtotal, total_amount, created_at, expires_at) VALUES ('ORD-PAST', ?, 0, 0, now(), now() - interval '1 minute')", machine))
                .hasMessageContaining("ck_orders_expires_at");
        jdbc.update("INSERT INTO orders(order_code, machine_id, subtotal, total_amount, created_at, expires_at) VALUES ('ORD-OK', ?, 0, 0, now(), now() + interval '5 minutes')", machine);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_indexes WHERE indexname='ix_orders_pending_expiry' AND indexdef LIKE '%PENDING_PAYMENT%'", Long.class)).isEqualTo(1);
    }
}
