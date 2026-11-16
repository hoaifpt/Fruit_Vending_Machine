package com.fruitmachine.backend.machine.dto.event;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.machine.enums.MachineEventSource;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "One entry of a machine's history: a message the machine sent (MACHINE) or a backend decision about it (BACKEND).")
public record MachineEventResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Event UUID.") UUID id,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "MACHINE: the reported eventType (DISPENSE_ACCEPTED, FAULT, BOOT, unknown types too), "
                + "STATUS_ONLINE or STATUS_OFFLINE; BACKEND: BACKEND_DISPENSE_FAILED, BACKEND_DISPENSE_LATE_SUCCESS, BACKEND_DISPENSE_MULTIPLE_BOWLS, "
                + "BACKEND_MAINTENANCE_ENTERED, BACKEND_REBOOT_DETECTED.", example = "DISPENSE_ABORTED") String eventType,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "MACHINE or BACKEND.") MachineEventSource source,
        @Schema(description = "Envelope messageId of a MACHINE event (unique per machine); null for BACKEND events.", types = {"string", "null"}, example = "a1b2c3d4-0042") String messageId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "object", description = "MACHINE: the message payload as the machine sent it. "
                + "Untrusted device data: render it escaped, never as HTML. BACKEND: ids and reason only.") JsonNode payload,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Backend receive or decision instant, UTC.") Instant createdAt) { }
