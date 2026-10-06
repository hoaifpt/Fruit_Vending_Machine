package com.fruitmachine.backend.product.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;

@Schema(description = "Replace catalog fields only. SKU/status/identity/timestamps are rejected.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateProductRequest(
        @NotBlank @Size(min = 1, max = 200)
        @Schema(description = "Nonblank catalog name, stripped before saving.", example = "Mango Fruit Box") String name,
        @Schema(description = "Optional catalog description; omitted/null clears it.", types = {"string", "null"}, example = "Fresh prepared mango") String description,
        @NotNull @DecimalMin(value = "0", inclusive = false) @DecimalMax("9999999999.99") @Digits(integer = 10, fraction = 2)
        @Schema(description = "Positive catalog price, maximum 9999999999.99, at most two decimal places; historical prices unchanged.", multipleOf = 0.01, example = "35000.00") BigDecimal price,
        @Size(max = 2048)
        @Schema(description = "Optional image reference; omitted/null clears it. Maximum 2048 characters.", types = {"string", "null"}, example = "https://example.com/products/mango.jpg") String imageUrl) {
    public UpdateProductRequest {
        name = name == null ? null : name.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
