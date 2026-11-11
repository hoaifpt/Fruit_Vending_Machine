package com.fruitmachine.backend.user.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(description = "A role and the permission codes it grants. Roles cannot be created, renamed or deleted through the API.")
public record RoleResponse(
        UUID id,
        @Schema(description = "Role name (uppercase).", example = "STAFF") String name,
        @Schema(description = "Role description.", nullable = true, example = "Machine operations and inventory staff") String description,
        @Schema(description = "Granted permission codes, sorted.", example = "[\"BATCH_CREATE\", \"BATCH_READ\", \"INVENTORY_READ\"]") List<String> permissions) {
}
