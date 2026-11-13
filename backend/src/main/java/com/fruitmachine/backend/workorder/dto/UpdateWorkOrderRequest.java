package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;

@Schema(description = "Partial edit: a field left out (or null) is unchanged; description \"\" clears it. version is required.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateWorkOrderRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "version from the last read; stale -> 409.") Long version,
        @Size(max = 200) @Schema(types = {"string", "null"}, maxLength = 200) String title,
        @Size(max = 2000) @Schema(types = {"string", "null"}, maxLength = 2000) String description,
        @Schema(types = {"string", "null"}) WorkOrderPriority priority,
        @Schema(types = {"string", "null"}, format = "date-time", description = "Not in the past; changing it re-arms the overdue notification.") Instant dueAt) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
