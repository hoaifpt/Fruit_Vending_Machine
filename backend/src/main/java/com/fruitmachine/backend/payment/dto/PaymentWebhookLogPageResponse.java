package com.fruitmachine.backend.payment.dto;

import java.util.List;

public record PaymentWebhookLogPageResponse(List<PaymentWebhookLogSummaryResponse> content, int page, int size, long totalElements, int totalPages) {
}
