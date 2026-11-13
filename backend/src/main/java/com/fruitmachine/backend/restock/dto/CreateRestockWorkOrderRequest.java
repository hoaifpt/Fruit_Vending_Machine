package com.fruitmachine.backend.restock.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "A RESTOCK work order from the machine's suggestions: one line per slot whose suggested action is not NONE (slots without a "
        + "product skipped); open LOW_STOCK / PRODUCT_* alerts of those slots are linked.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateRestockWorkOrderRequest(
        @NotNull @AssertTrue(message = "fromSuggestions must be true") @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = "true") Boolean fromSuggestions,
        @Size(max = 200) @Schema(types = {"string", "null"}, maxLength = 200, description = "Default: \"Nạp hàng máy <code>\".") String title,
        @Schema(types = {"string", "null"}) WorkOrderPriority priority,
        @Schema(types = {"string", "null"}, format = "uuid") UUID assigneeId,
        @Schema(types = {"string", "null"}, format = "date-time") Instant dueAt) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
