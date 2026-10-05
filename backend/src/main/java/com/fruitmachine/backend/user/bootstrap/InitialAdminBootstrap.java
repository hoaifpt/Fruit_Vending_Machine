package com.fruitmachine.backend.user.bootstrap;

import com.fruitmachine.backend.config.properties.InitialAdminProperties;
import com.fruitmachine.backend.config.properties.PasswordPolicyProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@EnableConfigurationProperties({InitialAdminProperties.class, PasswordPolicyProperties.class})
public class InitialAdminBootstrap implements ApplicationRunner {
    private static final Logger LOG = LoggerFactory.getLogger(InitialAdminBootstrap.class);
    private final InitialAdminBootstrapService service;
    private final InitialAdminProperties properties;

    public InitialAdminBootstrap(InitialAdminBootstrapService service, InitialAdminProperties properties) {
        this.service = service;
        this.properties = properties;
    }

    @Override
    public void run(ApplicationArguments args) {
        LOG.info("Initial admin bootstrap started");
        boolean created = service.bootstrap(properties);
        LOG.info(created ? "Initial ADMIN account created successfully" : "ADMIN already exists; bootstrap skipped");
    }
}
