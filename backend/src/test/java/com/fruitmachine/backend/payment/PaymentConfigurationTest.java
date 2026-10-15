package com.fruitmachine.backend.payment;

import com.fruitmachine.backend.config.properties.PaymentProperties;
import com.fruitmachine.backend.payment.gateway.PaymentGatewayRegistry;
import com.fruitmachine.backend.payment.gateway.mock.MockPaymentGateway;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Startup behavior of the payment configuration without a database. */
class PaymentConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(PaymentGatewayRegistry.class, MockPaymentGateway.class);

    private PaymentProperties bind(Map<String, String> overrides) {
        var values = new HashMap<String, String>(overrides);
        values.putIfAbsent("app.payment.provider", "MOCK");
        return new Binder(new MapConfigurationPropertySource(values)).bind("app.payment", PaymentProperties.class).get();
    }

    @Test
    void mockIsTheDevelopmentDefaultAndResolvesAsTheSingleActiveGateway() {
        runner.withPropertyValues("app.payment.provider=mock").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(PaymentGatewayRegistry.class).active().provider()).isEqualTo("MOCK");
        });
        runner.run(context -> assertThat(context.getBean(PaymentGatewayRegistry.class).active().provider()).isEqualTo("MOCK"));
    }

    @Test
    void unknownProviderFailsStartupWithAClearMessage() {
        runner.withPropertyValues("app.payment.provider=NOPE").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(IllegalStateException.class)
                    .rootCause().hasMessageContaining("Unknown app.payment.provider 'NOPE'").hasMessageContaining("MOCK");
        });
    }

    @Test
    void prodProfileRejectsMock() {
        runner.withPropertyValues("app.payment.provider=MOCK").withInitializer(context -> context.getEnvironment().setActiveProfiles("prod"))
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure()).rootCause().hasMessageContaining("MOCK").hasMessageContaining("prod");
                });
    }

    @Test
    void defaultsMatchTheDocumentedConfiguration() {
        var properties = bind(Map.of());
        assertThat(properties.provider()).isEqualTo("MOCK");
        assertThat(properties.attemptTtl()).isEqualTo(Duration.ofMinutes(5));
        assertThat(properties.minRemainingHold()).isEqualTo(Duration.ofSeconds(30));
        assertThat(properties.maxAttemptsPerOrder()).isEqualTo(5);
        assertThat(properties.providerTimeout()).isEqualTo(Duration.ofSeconds(10));
        assertThat(bind(Map.of("app.payment.min-remaining-hold", "PT0S")).minRemainingHold()).isZero();
    }

    @Test
    void invalidValuesFailBinding() {
        for (var invalid : java.util.List.of(
                Map.of("app.payment.attempt-ttl", "PT0S"), Map.of("app.payment.attempt-ttl", "-PT1M"),
                Map.of("app.payment.min-remaining-hold", "-PT1S"), Map.of("app.payment.max-attempts-per-order", "0"),
                Map.of("app.payment.provider-timeout", "PT0S"), Map.of("app.payment.provider-timeout", "-PT5S"),
                Map.of("app.payment.provider", " "))) {
            assertThatThrownBy(() -> bind(invalid)).as("%s", invalid).isInstanceOf(RuntimeException.class);
        }
    }
}
