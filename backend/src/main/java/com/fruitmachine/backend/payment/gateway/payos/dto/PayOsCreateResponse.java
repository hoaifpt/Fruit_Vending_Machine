package com.fruitmachine.backend.payment.gateway.payos.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Only the fields this adapter uses; checkoutUrl and paymentLinkId are deliberately not read or stored. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record PayOsCreateResponse(String code, String desc, Data data) {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Data(String qrCode) {
        @Override
        public String toString() {
            return "Data[qrCode=<redacted>]";
        }
    }
}
