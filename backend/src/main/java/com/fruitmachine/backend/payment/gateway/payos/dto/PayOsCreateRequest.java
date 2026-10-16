package com.fruitmachine.backend.payment.gateway.payos.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Body of POST /v2/payment-requests. Contains the signature, so it must never be logged. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PayOsCreateRequest(long orderCode, long amount, String description, String returnUrl, String cancelUrl,
        Long expiredAt, String signature) {
    @Override
    public String toString() {
        return "PayOsCreateRequest[orderCode=" + orderCode + ", amount=" + amount + "]";
    }
}
