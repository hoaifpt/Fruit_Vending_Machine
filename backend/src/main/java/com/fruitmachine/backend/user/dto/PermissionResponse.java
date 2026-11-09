package com.fruitmachine.backend.user.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "A permission of the catalog. Permissions are reference data added by migrations, never through the API.")
public record PermissionResponse(
        @Schema(description = "Stable permission code checked by the backend.", example = "PRODUCT_WRITE") String code,
        @Schema(description = "What the permission allows.", example = "Create and update products and change product status") String description) {
}
