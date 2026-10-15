package com.fruitmachine.backend.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Scheduling is opt-out through app.order.expiry-sweep.enabled; tests disable it and call the service directly. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(name = "app.order.expiry-sweep.enabled", havingValue = "true", matchIfMissing = true)
public class SchedulingConfig {
}
