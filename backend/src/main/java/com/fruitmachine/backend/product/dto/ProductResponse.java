package com.fruitmachine.backend.product.dto;

import com.fruitmachine.backend.product.enums.ProductStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Catalog definition only; no batch/inventory/slot or history collections.")
public record ProductResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Product UUID.") UUID id,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Immutable SKU.", example = "MANGO-BOX-001") String sku,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Catalog name.", example = "Mango Fruit Box") String name,
        @Schema(description = "Optional description.", types = {"string", "null"}) String description,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Current catalog price; historical order/payment snapshots unchanged.", example = "35000.00") BigDecimal price,
        @Schema(description = "Optional image reference.", types = {"string", "null"}) String imageUrl,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Current catalog availability.") ProductStatus status,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Creation instant in UTC.") Instant createdAt,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Last modification instant in UTC.") Instant updatedAt) { }
