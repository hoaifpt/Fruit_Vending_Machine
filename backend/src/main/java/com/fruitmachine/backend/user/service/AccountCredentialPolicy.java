package com.fruitmachine.backend.user.service;

import com.fruitmachine.backend.config.properties.PasswordPolicyProperties;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.springframework.stereotype.Service;

/** Reusable creation policy; authentication must still accept existing account passwords. */
@Service
public class AccountCredentialPolicy {
    private final Validator validator;
    private final PasswordPolicyProperties properties;

    public AccountCredentialPolicy(Validator validator, PasswordPolicyProperties properties) {
        this.validator = validator;
        this.properties = properties;
    }

    public String normalizeEmail(String email) {
        String normalized = email == null ? "" : email.strip().toLowerCase(Locale.ROOT);
        if (!validator.validate(new EmailValue(normalized)).isEmpty()) {
            throw new IllegalArgumentException("Email must be a valid email (maximum 254 characters)");
        }
        return normalized;
    }

    public void validateNewPassword(String password) {
        int minimum = properties.minLength();
        if (minimum < 8 || minimum > 72) {
            throw new IllegalStateException("Account password policy: PASSWORD_MIN_LENGTH must be between 8 and 72");
        }
        if (password == null || password.isBlank() || password.codePointCount(0, password.length()) < minimum
                || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new IllegalArgumentException("Password must contain at least "
                    + minimum + " characters and at most 72 UTF-8 bytes");
        }
    }

    private record EmailValue(@NotBlank @Email @Size(max = 254) String email) {
        @Override
        public String toString() {
            return "EmailValue[REDACTED]";
        }
    }
}
