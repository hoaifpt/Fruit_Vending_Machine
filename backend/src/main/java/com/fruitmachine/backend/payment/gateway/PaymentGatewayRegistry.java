package com.fruitmachine.backend.payment.gateway;

import com.fruitmachine.backend.config.properties.PaymentProperties;
import com.fruitmachine.backend.payment.gateway.mock.MockPaymentGateway;
import java.util.List;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/** Resolves the single configured gateway; an unknown provider, MOCK in prod or incomplete provider configuration stops the application. */
@Component
@EnableConfigurationProperties(PaymentProperties.class)
public class PaymentGatewayRegistry {
    private final PaymentGateway active;

    public PaymentGatewayRegistry(List<PaymentGateway> gateways, PaymentProperties properties, Environment environment) {
        String code = properties.provider();
        this.active = gateways.stream().filter(gateway -> gateway.provider().equals(code)).findFirst()
                .orElseThrow(() -> new IllegalStateException("Unknown app.payment.provider '" + code + "'; available: "
                        + gateways.stream().map(PaymentGateway::provider).sorted().toList()));
        if (MockPaymentGateway.PROVIDER.equals(code) && environment.acceptsProfiles(Profiles.of("prod"))) {
            throw new IllegalStateException("app.payment.provider=MOCK is for local development and tests only and is not allowed in the prod profile");
        }
        // Only the active provider must be fully configured; inactive gateways stay inert (MOCK needs no payOS secrets).
        active.validateConfiguration();
    }

    public PaymentGateway active() {
        return active;
    }
}
