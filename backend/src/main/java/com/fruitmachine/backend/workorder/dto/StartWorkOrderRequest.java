package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Optional body. stopMachine only matters for INCIDENT (RESTOCK and MAINTENANCE always stop the machine).",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record StartWorkOrderRequest(@Schema(types = {"boolean", "null"}, description = "INCIDENT: put the machine in MAINTENANCE. Default false.") Boolean stopMachine) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
