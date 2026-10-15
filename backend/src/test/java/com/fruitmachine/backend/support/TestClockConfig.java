package com.fruitmachine.backend.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Replaces the application clock (including JPA auditing) with an advanceable test clock. */
@TestConfiguration(proxyBeanMethods = false)
public class TestClockConfig {
    @Bean
    @Primary
    public OffsetClock testClock() {
        return new OffsetClock();
    }
}
