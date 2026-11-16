package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(description = "A new work order (source MANUAL). Unknown fields are rejected.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateWorkOrderRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = "MAINTENANCE") WorkOrderType type,
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "uuid") UUID machineId,
        @NotBlank @Size(max = 200) @Schema(requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 200, example = "Kiểm tra servo cột A") String title,
        @Size(max = 2000) @Schema(types = {"string", "null"}, maxLength = 2000) String description,
        @Schema(types = {"string", "null"}, description = "Default NORMAL.", example = "HIGH") WorkOrderPriority priority,
        @Schema(types = {"string", "null"}, format = "uuid", description = "Optional: an ACTIVE user holding WORK_ORDER_EXECUTE.") UUID assigneeId,
        @Schema(types = {"string", "null"}, format = "date-time", description = "Optional; not in the past.") Instant dueAt,
        @Valid @Schema(description = "Issue #68, RESTOCK only (needs RESTOCK_PLAN): planned lines; other types must leave it out.") List<RestockLineInput> restockLines) {
    public CreateWorkOrderRequest {
        title = title == null ? null : title.strip();
        description = description == null || description.isBlank() ? null : description.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
