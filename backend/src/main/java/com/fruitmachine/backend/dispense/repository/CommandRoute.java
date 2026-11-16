package com.fruitmachine.backend.dispense.repository;

import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import java.time.Instant;
import java.util.UUID;

/** Unlocked snapshot of a command, read before any lock to know which machine and order to lock and in which mode. */
public record CommandRoute(UUID id, UUID orderId, UUID machineId, String machineCode, DispenseStatus status, Instant sentAt) {
}
