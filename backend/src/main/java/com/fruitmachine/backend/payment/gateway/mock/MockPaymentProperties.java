package com.fruitmachine.backend.payment.gateway.mock;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** MOCK webhook signing secret. A blank secret makes every MOCK webhook fail verification. Masked in toString. */
@ConfigurationProperties("app.payment.mock")
public record MockPaymentProperties(@DefaultValue("") String webhookSecret) {
    @Override
    public String toString() {
        return "MockPaymentProperties[webhookSecret=" + (webhookSecret == null || webhookSecret.isBlank() ? "<unset>" : "***") + "]";
    }
}
