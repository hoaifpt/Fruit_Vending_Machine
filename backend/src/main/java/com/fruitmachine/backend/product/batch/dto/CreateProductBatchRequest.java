package com.fruitmachine.backend.product.batch.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

@Schema(description = "Create immutable traceability batch. Creator and creation time are server-controlled; no inventory is created.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateProductBatchRequest(
        @NotBlank @Size(min = 1, max = 64)
        @Schema(description = "Globally unique, immutable code, stripped and uppercased with Locale.ROOT.", example = "MANGO-20261010-01") String batchCode,
        @NotNull @Schema(description = "Existing ACTIVE product UUID.") UUID productId,
        @NotNull @JsonDeserialize(using = BatchRequestDeserializers.Timestamp.class)
        @Schema(description = "Preparation time, ISO-8601 string with Z or explicit offset; normalized to UTC, truncated to database microseconds.", type = "string", format = "date-time", example = "2026-10-10T01:00:00Z") Instant manufacturedAt,
        @NotNull @JsonDeserialize(using = BatchRequestDeserializers.Timestamp.class)
        @Schema(description = "Expiration instant, strictly after preparation and current server time. Same offset/precision rules as manufacturedAt.", type = "string", format = "date-time", example = "2026-10-12T01:00:00Z") Instant expiresAt,
        @NotNull @Positive @JsonDeserialize(using = BatchRequestDeserializers.Quantity.class)
        @Schema(description = "Original declared units, not current stock. JSON integer token only, 1 through 2147483647.", minimum = "1", maximum = "2147483647", example = "20") Integer quantity) {
    public CreateProductBatchRequest {
        batchCode = batchCode == null ? null : batchCode.strip().toUpperCase(Locale.ROOT);
        manufacturedAt = manufacturedAt == null ? null : manufacturedAt.truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        expiresAt = expiresAt == null ? null : expiresAt.truncatedTo(java.time.temporal.ChronoUnit.MICROS);
    }
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) { throw new IllegalArgumentException("Unknown request field"); }
}
