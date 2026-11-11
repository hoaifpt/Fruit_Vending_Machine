package com.fruitmachine.backend.dispense.event;

import java.util.UUID;

/**
 * The machine reported more than one bowl for one command. The ordered bowl is sold; the others are not identified and staff
 * must reconcile the column. {@code bowlCount} is null when the machine only sent the reason.
 */
public record DispenseMultipleBowlsEvent(UUID commandId, String commandCode, UUID machineId, UUID slotId, UUID orderId, Integer bowlCount) {
}
