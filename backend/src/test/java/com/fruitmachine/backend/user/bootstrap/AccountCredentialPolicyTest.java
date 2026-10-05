package com.fruitmachine.backend.user.bootstrap;

import com.fruitmachine.backend.config.properties.PasswordPolicyProperties;
import com.fruitmachine.backend.user.service.AccountCredentialPolicy;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.*;

class AccountCredentialPolicyTest {
    @Test
    void configuredMinimumIsAppliedOnlyForAccountCreation() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var policy = new AccountCredentialPolicy(factory.getValidator(), new PasswordPolicyProperties(16));
            assertThatThrownBy(() -> policy.validateNewPassword("test-only-12345"))
                    .hasMessageContaining("at least 16").hasMessageNotContaining("test-only-12345");
            assertThatCode(() -> policy.validateNewPassword("Test-only-long-passphrase!"))
                    .doesNotThrowAnyException();
            assertThat(policy.normalizeEmail("  TEST@EXAMPLE.INVALID ")).isEqualTo("test@example.invalid");
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 7, 73})
    void invalidPolicyConfigurationHasClearValueFreeError(int minimum) {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var policy = new AccountCredentialPolicy(factory.getValidator(), new PasswordPolicyProperties(minimum));
            assertThatThrownBy(() -> policy.validateNewPassword("Test-only-long-passphrase!"))
                    .hasMessageContaining("PASSWORD_MIN_LENGTH").hasMessageNotContaining("Test-only-long-passphrase!");
        }
    }

    @Test
    void bcryptByteBoundaryAndUnicodeCharacterMinimumAreRespected() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var policy = new AccountCredentialPolicy(factory.getValidator(), new PasswordPolicyProperties(12));
            assertThatCode(() -> policy.validateNewPassword("a".repeat(72))).doesNotThrowAnyException();
            assertThatCode(() -> policy.validateNewPassword("ấ".repeat(24))).doesNotThrowAnyException();
            assertThatCode(() -> policy.validateNewPassword("😀".repeat(12))).doesNotThrowAnyException();
            assertThatThrownBy(() -> policy.validateNewPassword("a".repeat(73))).hasMessageContaining("72 UTF-8 bytes");
            assertThatThrownBy(() -> policy.validateNewPassword("ấ".repeat(25))).hasMessageContaining("72 UTF-8 bytes");
            assertThatThrownBy(() -> policy.validateNewPassword("😀".repeat(11))).hasMessageContaining("at least 12");
        }
    }
}
