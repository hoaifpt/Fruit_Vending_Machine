package com.fruitmachine.backend.notification.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Number of unread notifications of the signed-in user (poll every 30 s).")
public record UnreadCountResponse(@Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Unread notifications.", example = "3") long unread) { }
