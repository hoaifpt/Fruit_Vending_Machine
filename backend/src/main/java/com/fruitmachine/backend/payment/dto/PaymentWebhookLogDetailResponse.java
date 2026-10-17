package com.fruitmachine.backend.payment.dto;

import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Webhook attempt with its evidence. rawPayload holds the parsed JSON; rawBody holds the exact text only when the body was not valid JSON. The signature is never returned.")
public record PaymentWebhookLogDetailResponse(UUID id, String provider,
        @Schema(nullable = true) String eventType, @Schema(nullable = true) String reference, boolean verified, Instant receivedAt,
        @Schema(description = "Parsed JSON body, null when the body was not valid JSON.", nullable = true, type = "object") JsonNode rawPayload,
        @Schema(description = "Exact received text, present only when rawPayload is null.", nullable = true) String rawBody) {
}
