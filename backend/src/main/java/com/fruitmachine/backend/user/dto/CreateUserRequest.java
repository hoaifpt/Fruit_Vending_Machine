package com.fruitmachine.backend.user.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Locale;

@Schema(description = "Create an ACTIVE STAFF account. Only these four fields are accepted; roles/status are server controlled.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateUserRequest(
        @NotBlank @Email @Size(min = 1, max = 254)
        @Schema(description = "Login email; stripped and lowercased before validation and persistence.", format = "email", example = "staff@example.com")
        String email,
        @NotBlank @Size(min = 1, max = 72)
        @Schema(description = "Unmodified password. Shared PASSWORD_MIN_LENGTH policy (default 12 Unicode code points); at most 72 UTF-8 bytes.",
                format = "password", accessMode = Schema.AccessMode.WRITE_ONLY)
        String password,
        @NotBlank @Size(min = 1, max = 200)
        @Schema(description = "Nonblank display name, stripped before saving.", example = "Nguyen Van A") String fullName,
        @Size(max = 32)
        @Schema(description = "Optional contact phone, maximum 32 characters; null clears it.", types = {"string", "null"}, example = "0901234567") String phone) {
    public CreateUserRequest {
        email = email == null ? null : email.strip().toLowerCase(Locale.ROOT);
    }

    @JsonAnySetter
    public void rejectUnknownField(String name, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }

    @Override
    public String toString() {
        return "CreateUserRequest[credentials=REDACTED]";
    }
}
