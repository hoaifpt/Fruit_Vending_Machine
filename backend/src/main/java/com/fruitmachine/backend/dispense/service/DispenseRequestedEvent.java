package com.fruitmachine.backend.dispense.service;

import java.util.UUID;

/** Published inside the payment transaction; the command is sent only after that transaction commits. */
public record DispenseRequestedEvent(UUID commandId) {
}
