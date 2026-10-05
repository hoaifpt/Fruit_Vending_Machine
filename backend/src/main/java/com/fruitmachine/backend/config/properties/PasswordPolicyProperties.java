package com.fruitmachine.backend.config.properties;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("app.account.password")
public record PasswordPolicyProperties(@DefaultValue("12") int minLength) {
}
