package com.fruitmachine.backend.machine.kiosk.dto;

import com.fruitmachine.backend.machine.kiosk.enums.KioskCredentialStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Newly issued kiosk credential. The plaintext apiKey is shown exactly once and never returned again.")
public record IssuedKioskCredentialResponse(
        UUID credentialId,
        UUID machineId,
        @Schema(description = "Non-secret lookup prefix, safe to display.", example = "a1b2c3d4e5f6") String keyPrefix,
        @Schema(description = "Plaintext key for the X-Kiosk-Key header; shown once. Fake example only.", example = "fvk_a1b2c3d4e5f6_<shown-once>") String apiKey,
        KioskCredentialStatus status,
        Instant createdAt) {
}
