package com.fruitmachine.backend.user.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.user.enums.UserStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "Change account availability. Self-disable/lock and removing the last ACTIVE ADMIN are conflicts.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateUserStatusRequest(
        @NotNull @Schema(description = "ACTIVE = usable; INACTIVE = disabled; LOCKED = blocked.", example = "INACTIVE") UserStatus status) {
    @JsonAnySetter
    public void rejectUnknownField(String name, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
