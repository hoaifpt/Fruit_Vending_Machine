package com.fruitmachine.backend.config.properties;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("app.bootstrap.admin")
public record InitialAdminProperties(String email, String password, String fullName) {
    // Validate only after checking for an existing ADMIN. Secrets may be removed after provisioning.
    @Override
    public String toString() {
        return "InitialAdminProperties[REDACTED]";
    }
}
