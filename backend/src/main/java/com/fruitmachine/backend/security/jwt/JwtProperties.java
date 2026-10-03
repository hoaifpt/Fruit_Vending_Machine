package com.fruitmachine.backend.security.jwt;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("security.jwt")
public record JwtProperties(String secret, long expirationSeconds) {
    // Do not let record-generated toString expose configuration secrets.
    @Override
    public String toString() {
        return "JwtProperties[secret=REDACTED, expirationSeconds=" + expirationSeconds + "]";
    }
}
