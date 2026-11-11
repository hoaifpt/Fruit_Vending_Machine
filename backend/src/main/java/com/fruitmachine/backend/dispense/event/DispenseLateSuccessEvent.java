package com.fruitmachine.backend.dispense.event;

import java.util.UUID;

/** DISPENSE_COMPLETED arrived after the command had failed or timed out, and the order was completed (it was not refunded). */
public record DispenseLateSuccessEvent(UUID commandId, String commandCode, UUID machineId, UUID slotId, UUID orderId) {
}
