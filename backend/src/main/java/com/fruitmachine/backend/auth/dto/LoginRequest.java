package com.fruitmachine.backend.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "Management account login. Email is normalized to lowercase; password is not modified.")
public record LoginRequest(
        @NotBlank @Email @Size(min = 1, max = 254)
        @Schema(description = "Account email (maximum 254 characters)", example = "developer@example.com", format = "email")
        String email,
        @NotBlank @Size(min = 1, max = 72)
        @Schema(description = "Account password; BCrypt accepts at most 72 UTF-8 bytes (not just characters).",
                format = "password", accessMode = Schema.AccessMode.WRITE_ONLY)
        String password) {
    @Override
    public String toString() {
        return "LoginRequest[credentials=REDACTED]";
    }
}
