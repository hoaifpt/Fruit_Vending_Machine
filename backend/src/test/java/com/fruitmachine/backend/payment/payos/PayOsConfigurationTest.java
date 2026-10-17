package com.fruitmachine.backend.payment.payos;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.payment.gateway.PaymentGatewayRegistry;
import com.fruitmachine.backend.payment.gateway.mock.MockPaymentGateway;
import com.fruitmachine.backend.payment.gateway.payos.PayOsPaymentGateway;
import com.fruitmachine.backend.payment.gateway.payos.PayOsProperties;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import static org.assertj.core.api.Assertions.assertThat;

/** Startup behavior of the provider selection and payOS configuration, without a database. */
class PayOsConfigurationTest {
    static final String SECRET_KEY = "unit-secret-api-key-123";
    static final String SECRET_CHECKSUM = "unit-secret-checksum-456";

    @Configuration(proxyBeanMethods = false)
    static class Support {
        @Bean Clock clock() { return Clock.systemUTC(); }
        @Bean ObjectMapper objectMapper() { return new ObjectMapper(); }
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(Support.class, PaymentGatewayRegistry.class, MockPaymentGateway.class, PayOsPaymentGateway.class,
                    com.fruitmachine.backend.payment.gateway.payos.PayOsWebhookVerifier.class, com.fruitmachine.backend.payment.gateway.payos.PayOsWebhookParser.class);

    private static final String[] COMPLETE = {"app.payment.payos.client-id=unit-client", "app.payment.payos.api-key=" + SECRET_KEY,
            "app.payment.payos.checksum-key=" + SECRET_CHECKSUM, "app.payment.payos.return-url=https://shop.example.invalid/return",
            "app.payment.payos.cancel-url=https://shop.example.invalid/cancel"};

    private static String chain(Throwable failure) {
        List<String> messages = new ArrayList<>();
        for (Throwable t = failure; t != null; t = t.getCause()) messages.add(String.valueOf(t.getMessage()));
        return String.join(" | ", messages);
    }

    @Test
    void mockStartsWithoutAnyPayOsProperty() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(PaymentGatewayRegistry.class).active().provider()).isEqualTo("MOCK");
            // The payOS adapter exists but is inert.
            assertThat(context.getBean(PayOsPaymentGateway.class).provider()).isEqualTo("PAYOS");
        });
        runner.withPropertyValues("app.payment.provider=mock").run(context -> assertThat(context).hasNotFailed());
    }

    @Test
    void payosWithEveryRequiredValueBlankFailsStartupNamingTheProperties() {
        runner.withPropertyValues("app.payment.provider=PAYOS").run(context -> {
            assertThat(context).hasFailed();
            String message = chain(context.getStartupFailure());
            assertThat(message).contains("app.payment.payos.client-id", "app.payment.payos.api-key", "app.payment.payos.checksum-key",
                    "app.payment.payos.return-url", "app.payment.payos.cancel-url");
        });
    }

    @Test
    void eachMissingRequiredValueFailsStartupAndNoSecretIsPrinted() {
        String[][] missing = {{"client-id", "app.payment.payos.client-id"}, {"api-key", "app.payment.payos.api-key"},
                {"checksum-key", "app.payment.payos.checksum-key"}, {"return-url", "app.payment.payos.return-url"}, {"cancel-url", "app.payment.payos.cancel-url"}};
        for (String[] gone : missing) {
            List<String> values = new ArrayList<>(List.of(COMPLETE));
            values.removeIf(v -> v.startsWith("app.payment.payos." + gone[0] + "="));
            values.add("app.payment.provider=PAYOS");
            runner.withPropertyValues(values.toArray(String[]::new)).run(context -> {
                assertThat(context).as(gone[0]).hasFailed();
                String message = chain(context.getStartupFailure());
                assertThat(message).contains(gone[1]).doesNotContain(SECRET_KEY, SECRET_CHECKSUM, "unit-client");
            });
        }
    }

    @Test
    void invalidUrlsAndDescriptionSettingsAreRejectedWithoutEchoingValues() {
        List<String> base = new ArrayList<>(List.of(COMPLETE));
        base.add("app.payment.provider=PAYOS");
        for (String bad : new String[]{"app.payment.payos.return-url=not a url", "app.payment.payos.cancel-url=ftp://x.example.invalid/c",
                "app.payment.payos.base-url=/relative", "app.payment.payos.description-max-length=2", "app.payment.payos.description-max-length=99",
                "app.payment.payos.description-prefix=F V", "app.payment.payos.cancel-timeout=PT0S"}) {
            List<String> values = new ArrayList<>(base);
            values.add(bad);
            runner.withPropertyValues(values.toArray(String[]::new)).run(context -> {
                assertThat(context).as(bad).hasFailed();
                assertThat(chain(context.getStartupFailure())).contains(bad.substring(0, bad.indexOf('=')).replace("app.payment.payos.", "app.payment.payos.")).doesNotContain(SECRET_KEY, SECRET_CHECKSUM);
            });
        }
    }

    @Test
    void completePayosConfigurationSelectsTheAdapterAlsoUnderTheProdProfile() {
        List<String> values = new ArrayList<>(List.of(COMPLETE));
        values.add("app.payment.provider=payos");
        runner.withPropertyValues(values.toArray(String[]::new)).run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(PaymentGatewayRegistry.class).active().provider()).isEqualTo("PAYOS");
        });
        runner.withPropertyValues(values.toArray(String[]::new)).withInitializer(c -> c.getEnvironment().setActiveProfiles("prod"))
                .run(context -> assertThat(context).hasNotFailed());
    }

    @Test
    void propertiesToStringNeverRevealsSecrets() {
        var props = new PayOsProperties("https://api-merchant.payos.vn", "client-visible-id", SECRET_KEY, SECRET_CHECKSUM,
                "https://shop.example.invalid/r", "https://shop.example.invalid/c", "FV", 9, Duration.ofSeconds(3));
        assertThat(props.toString()).doesNotContain(SECRET_KEY, SECRET_CHECKSUM, "client-visible-id").contains("apiKey=***", "checksumKey=***", "https://api-merchant.payos.vn");
        assertThat(props.problems()).isEmpty();
        assertThat(new PayOsProperties("https://api-merchant.payos.vn", "", "", "", "", "", "FV", 9, Duration.ofSeconds(3)).toString()).contains("apiKey=<unset>");
    }
}
