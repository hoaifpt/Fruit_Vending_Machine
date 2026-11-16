package com.fruitmachine.backend.notification.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "How many notifications this call marked read (already read ones are not counted).")
public record MarkedReadResponse(@Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Notifications marked read.", example = "3") int marked) { }
