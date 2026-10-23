package com.fruitmachine.backend.dispense.service;

import jakarta.validation.constraints.AssertTrue;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("app.dispense")
public record DispenseProperties(@DefaultValue("PT2M") Duration timeout) {
    @AssertTrue(message = "Dispense timeout must be positive")
    public boolean isValidTimeout() { return timeout != null && !timeout.isZero() && !timeout.isNegative(); }
}
