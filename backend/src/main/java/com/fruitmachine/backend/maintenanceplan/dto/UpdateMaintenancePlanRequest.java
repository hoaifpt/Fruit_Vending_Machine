package com.fruitmachine.backend.maintenanceplan.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fruitmachine.backend.inventory.dto.InventoryQuantityDeserializer;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

@Schema(description = "Partial change; a field left out (or null) is unchanged. instructions \"\" clears them; clearDefaultAssignee=true removes the "
        + "default assignee. Changing intervalDays does not move nextDueDate.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateMaintenancePlanRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "version from the last read; stale -> 409.") Long version,
        @Size(max = 200) @Schema(types = {"string", "null"}, maxLength = 200) String title,
        @Size(max = 2000) @Schema(types = {"string", "null"}, maxLength = 2000) String instructions,
        @Min(1) @Max(365) @JsonDeserialize(using = InventoryQuantityDeserializer.class) @Schema(types = {"integer", "null"}, minimum = "1", maximum = "365") Integer intervalDays,
        @Min(0) @Max(30) @JsonDeserialize(using = InventoryQuantityDeserializer.class) @Schema(types = {"integer", "null"}, minimum = "0", maximum = "30") Integer leadDays,
        @JsonFormat(pattern = "HH:mm") @Schema(types = {"string", "null"}, pattern = "^[0-2][0-9]:[0-5][0-9]$", example = "17:00") LocalTime dueTime,
        @Schema(types = {"string", "null"}) WorkOrderPriority priority,
        @Schema(types = {"string", "null"}, format = "uuid") UUID defaultAssigneeId,
        @Schema(types = {"boolean", "null"}, description = "true: no default assignee.") Boolean clearDefaultAssignee,
        @Schema(types = {"string", "null"}, format = "date", description = "Today or later.") LocalDate nextDueDate) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
