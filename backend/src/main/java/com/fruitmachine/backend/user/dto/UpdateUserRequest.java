package com.fruitmachine.backend.user.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "Replace profile fields only. Email, password, roles, status and persistence fields are rejected.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateUserRequest(
        @NotBlank @Size(min = 1, max = 200)
        @Schema(description = "Nonblank display name, stripped before saving.", example = "Nguyen Van B") String fullName,
        @Size(max = 32)
        @Schema(description = "Optional contact phone; omitted/null clears it (PUT replacement).", types = {"string", "null"}, example = "0912345678") String phone) {
    @JsonAnySetter
    public void rejectUnknownField(String name, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
