package com.fruitmachine.backend.product.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Locale;

@Schema(description = "Create catalog product; status is server-controlled ACTIVE.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateProductRequest(
        @NotBlank @Size(min = 1, max = 64)
        @Schema(description = "Stable unique SKU, stripped and uppercased with Locale.ROOT before validation.", example = "MANGO-BOX-001") String sku,
        @NotBlank @Size(min = 1, max = 200)
        @Schema(description = "Nonblank catalog name, stripped before saving.", example = "Mango Fruit Box") String name,
        @Schema(description = "Optional catalog description; null clears it.", types = {"string", "null"}, example = "Fresh prepared mango") String description,
        @NotNull @DecimalMin(value = "0", inclusive = false) @DecimalMax("9999999999.99") @Digits(integer = 10, fraction = 2)
        @Schema(description = "Positive catalog price, maximum 9999999999.99, at most two decimal places; never rounded.", multipleOf = 0.01, example = "35000.00") BigDecimal price,
        @Size(max = 2048)
        @Schema(description = "Optional image reference, maximum 2048 characters. No upload or URL fetching.", types = {"string", "null"}, example = "https://example.com/products/mango.jpg") String imageUrl) {
    public CreateProductRequest {
        sku = sku == null ? null : sku.strip().toUpperCase(Locale.ROOT);
        name = name == null ? null : name.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
