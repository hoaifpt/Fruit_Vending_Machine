package com.fruitmachine.backend.machine.kiosk.dto;

import com.fruitmachine.backend.machine.kiosk.enums.KioskCredentialStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Credential metadata. Never contains the key, its secret or its hash.")
public record KioskCredentialResponse(
        UUID credentialId,
        @Schema(example = "a1b2c3d4e5f6") String keyPrefix,
        KioskCredentialStatus status,
        Instant createdAt,
        UUID createdBy,
        Instant revokedAt,
        UUID revokedBy) {
}
