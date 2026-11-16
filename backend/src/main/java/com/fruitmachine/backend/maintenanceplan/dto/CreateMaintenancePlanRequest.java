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

@Schema(description = "A recurring maintenance plan. Dates are business-zone (Asia/Ho_Chi_Minh) dates, dueTime a local time there.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateMaintenancePlanRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "uuid") UUID machineId,
        @NotBlank @Size(max = 200) @Schema(requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 200, example = "Vệ sinh khoang lạnh") String title,
        @Size(max = 2000) @Schema(types = {"string", "null"}, maxLength = 2000, example = "Lau khay, kiểm tra gioăng") String instructions,
        @NotNull @Min(1) @Max(365) @JsonDeserialize(using = InventoryQuantityDeserializer.class)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1", maximum = "365", example = "7") Integer intervalDays,
        @Min(0) @Max(30) @JsonDeserialize(using = InventoryQuantityDeserializer.class)
        @Schema(types = {"integer", "null"}, minimum = "0", maximum = "30", description = "Days before the due date the work order is created; < intervalDays. Default 0.", example = "1") Integer leadDays,
        @JsonFormat(pattern = "HH:mm") @Schema(types = {"string", "null"}, pattern = "^[0-2][0-9]:[0-5][0-9]$", description = "Default 17:00.", example = "17:00") LocalTime dueTime,
        @Schema(types = {"string", "null"}, description = "Default NORMAL.") WorkOrderPriority priority,
        @Schema(types = {"string", "null"}, format = "uuid", description = "An ACTIVE user holding WORK_ORDER_EXECUTE.") UUID defaultAssigneeId,
        @Schema(types = {"string", "null"}, format = "date", description = "Today or later; default today + intervalDays.", example = "2026-11-20") LocalDate firstDueDate) {
    public CreateMaintenancePlanRequest {
        title = title == null ? null : title.strip();
        instructions = instructions == null || instructions.isBlank() ? null : instructions.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
