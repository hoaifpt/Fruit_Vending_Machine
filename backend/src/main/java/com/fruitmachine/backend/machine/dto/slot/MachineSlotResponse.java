package com.fruitmachine.backend.machine.dto.slot;

import com.fruitmachine.backend.machine.enums.SlotStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Slot identity, parent UUID, capacity and status only; no nested entities or current stock.")
public record MachineSlotResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Slot UUID.") UUID id,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Immutable owning machine UUID.") UUID machineId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Immutable code unique within the machine.", example = "A1") String slotCode,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Maximum physical capacity, not inventory quantity.", minimum = "1", maximum = "2147483647") Integer capacity,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Administrative slot status; independent of machine status.") SlotStatus status,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Creation instant, UTC.") Instant createdAt,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Modification instant, UTC.") Instant updatedAt) {}
