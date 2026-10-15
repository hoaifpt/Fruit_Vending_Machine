package com.fruitmachine.backend.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;

/** Registers the controllable provider; tests select it with app.payment.provider=TESTPAY. */
@TestConfiguration(proxyBeanMethods = false)
public class TestPaymentGatewayConfig {
    @Bean
    public ControllableGateway controllableGateway(JdbcTemplate jdbc) {
        return new ControllableGateway(jdbc);
    }
}
