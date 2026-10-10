package com.fruitmachine.backend.machine.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Locale;

@Schema(description = "Register machine, initial status INACTIVE and lastSeenAt null.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateMachineRequest(
        @NotBlank @Size(min = 1, max = 64)
        @Schema(description = "Stable unique code, stripped and uppercased with Locale.ROOT.", example = "FV-HCM-001") String code,
        @NotBlank @Size(min = 1, max = 200)
        @Schema(description = "Nonblank machine name, stripped.", example = "Fruit Machine - Campus A") String name,
        @NotBlank @Size(min = 1, max = 500)
        @Schema(description = "Nonblank installation location, stripped.", example = "Building A - Ground Floor") String location,
        @NotNull @DecimalMin("-100") @DecimalMax("100") @Digits(integer = 3, fraction = 2)
        @Schema(description = "Minimum configured Celsius threshold, strictly below maxTemperature; at most two decimals.", multipleOf = 0.01, example = "2.00") BigDecimal minTemperature,
        @NotNull @DecimalMin("-100") @DecimalMax("100") @Digits(integer = 3, fraction = 2)
        @Schema(description = "Maximum configured Celsius threshold, strictly above minTemperature; at most two decimals.", multipleOf = 0.01, example = "8.00") BigDecimal maxTemperature,
        @NotNull @DecimalMin("0") @DecimalMax("100") @Digits(integer = 3, fraction = 2)
        @Schema(description = "Minimum configured humidity percentage, strictly below maxHumidity; at most two decimals.", multipleOf = 0.01, example = "40.00") BigDecimal minHumidity,
        @NotNull @DecimalMin("0") @DecimalMax("100") @Digits(integer = 3, fraction = 2)
        @Schema(description = "Maximum configured humidity percentage, strictly above minHumidity; at most two decimals.", multipleOf = 0.01, example = "80.00") BigDecimal maxHumidity) {
    public CreateMachineRequest {
        code = code == null ? null : code.strip().toUpperCase(Locale.ROOT);
        name = name == null ? null : name.strip();
        location = location == null ? null : location.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
