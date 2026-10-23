package com.fruitmachine.backend.payment;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PaymentSchemaIntegrationTest extends AbstractCoreIntegrationTest {
    private UUID order() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String code = "ORD-SCHEMA-" + UUID.randomUUID();
        jdbc.update("INSERT INTO orders(order_code, machine_id, subtotal, total_amount) VALUES (?, ?, 10, 10)", code, machine);
        return jdbc.queryForObject("SELECT id FROM orders WHERE order_code=?", UUID.class, code);
    }

    private void insert(UUID order, String provider, String reference) {
        jdbc.update("INSERT INTO payments(order_id, provider, payment_reference, amount) VALUES (?, ?, ?, 10)", order, provider, reference);
    }

    @Test
    void v12IsAppliedAndValidatedWithTheReferenceIndex() throws Exception {
        flyway.validate();
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("13");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_indexes WHERE indexname='uq_payments_provider_reference' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%payment_reference IS NOT NULL%'", Long.class)).isEqualTo(1);
    }

    @Test
    void duplicateProviderAndReferenceIsRejectedButOtherNamespacesAndMissingReferencesAreAllowed() throws Exception {
        UUID order = order(), another = order();
        insert(order, "MOCK", "REF-1");
        assertThatThrownBy(() -> insert(order, "MOCK", "REF-1")).isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("uq_payments_provider_reference");
        // Even across orders: webhooks resolve by (provider, reference) alone.
        assertThatThrownBy(() -> insert(another, "MOCK", "REF-1")).isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("uq_payments_provider_reference");
        insert(order, "PAYOS", "REF-1");
        insert(order, "MOCK", "REF-2");
        jdbc.update("INSERT INTO payments(order_id, provider, amount) VALUES (?, 'MOCK', 10)", order);
        jdbc.update("INSERT INTO payments(order_id, provider, amount) VALUES (?, 'MOCK', 10)", order);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM payments WHERE order_id=?", Long.class, order)).isEqualTo(5);
    }
}
