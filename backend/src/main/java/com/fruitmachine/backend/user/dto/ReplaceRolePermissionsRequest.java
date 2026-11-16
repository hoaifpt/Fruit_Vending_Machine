package com.fruitmachine.backend.user.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

@Schema(description = "The complete new permission set of the role (replaces the old one). An empty list is allowed (role without access). "
        + "Unknown or duplicate codes are rejected; the ADMIN role must keep PERMISSION_MANAGE and USER_WRITE.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record ReplaceRolePermissionsRequest(
        @NotNull @Size(max = 200)
        @ArraySchema(schema = @Schema(description = "Permission code from GET /api/v1/permissions.", example = "PRODUCT_READ"),
                arraySchema = @Schema(description = "Permission codes; no duplicates.", example = "[\"PRODUCT_READ\", \"MACHINE_READ\", \"INVENTORY_READ\", \"INVENTORY_WRITE\"]",
                        requiredMode = Schema.RequiredMode.REQUIRED))
        List<@NotBlank String> permissions) {
    @JsonAnySetter
    public void rejectUnknownField(String name, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
