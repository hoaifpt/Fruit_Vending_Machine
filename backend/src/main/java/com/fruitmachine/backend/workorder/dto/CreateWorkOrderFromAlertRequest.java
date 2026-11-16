package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "A work order for an alert (source ALERT, the alert's machine). Every field is optional: type defaults from the alert type "
        + "(LOW_STOCK, PRODUCT_* -> RESTOCK, others MAINTENANCE), title from the alert title, priority from its severity "
        + "(CRITICAL -> URGENT, WARNING -> HIGH, INFO -> NORMAL).", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateWorkOrderFromAlertRequest(
        @Schema(types = {"string", "null"}) WorkOrderType type,
        @Size(max = 200) @Schema(types = {"string", "null"}, maxLength = 200) String title,
        @Size(max = 2000) @Schema(types = {"string", "null"}, maxLength = 2000) String description,
        @Schema(types = {"string", "null"}) WorkOrderPriority priority,
        @Schema(types = {"string", "null"}, format = "uuid") UUID assigneeId,
        @Schema(types = {"string", "null"}, format = "date-time") Instant dueAt) {
    public CreateWorkOrderFromAlertRequest {
        title = title == null || title.isBlank() ? null : title.strip();
        description = description == null || description.isBlank() ? null : description.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
