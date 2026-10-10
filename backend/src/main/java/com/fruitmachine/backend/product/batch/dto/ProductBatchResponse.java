package com.fruitmachine.backend.product.batch.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Immutable batch traceability; product SKU/name are current catalog values. UTC timestamps; no entity collections or stock counters.")
public record ProductBatchResponse(
        UUID id, String batchCode, UUID productId, String productSku, String productName,
        Instant manufacturedAt, Instant expiresAt,
        @Schema(description = "Original declared quantity, never current available stock.") Integer quantity,
        @Schema(description = "Creator UUID, set from authenticated user for new batches; null for legacy rows without a creator.", types = {"string", "null"}, format = "uuid") UUID createdBy,
        Instant createdAt) {}
