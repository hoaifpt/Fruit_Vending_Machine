package com.fruitmachine.backend.payment.dto;

import java.util.UUID;

/** The administrator who recorded a refund. */
public record RefundActorResponse(UUID id, String fullName) {
}
