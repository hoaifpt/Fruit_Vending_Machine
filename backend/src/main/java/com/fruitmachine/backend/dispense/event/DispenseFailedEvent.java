package com.fruitmachine.backend.dispense.event;

import java.util.UUID;

/**
 * A dispense command ended FAILED or TIMEOUT. {@code bowlReturned} is true when the machine certainly did not move (the bowl is
 * AVAILABLE again) and false when the physical outcome is unknown (the bowl is DISPENSE_FAILED and blocks its column).
 * Published inside the transaction; consume it after commit.
 */
public record DispenseFailedEvent(UUID commandId, String commandCode, UUID machineId, UUID slotId, UUID orderId, String reason,
        boolean bowlReturned) {
}
