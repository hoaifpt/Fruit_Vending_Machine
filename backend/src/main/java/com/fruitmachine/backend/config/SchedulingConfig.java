package com.fruitmachine.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Each scheduled job is opt-out through its own property (expiry sweep, dispense sweep); tests disable them and call the services directly. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
public class SchedulingConfig {
}
