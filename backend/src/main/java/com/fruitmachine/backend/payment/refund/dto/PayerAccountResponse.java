package com.fruitmachine.backend.payment.refund.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Payer bank account from the VERIFIED webhook of the payment (payOS counterAccount* fields); fields payOS did not send are null. Never logged.")
public record PayerAccountResponse(String accountName, String accountNumber, String bankId, String bankName) {
}
