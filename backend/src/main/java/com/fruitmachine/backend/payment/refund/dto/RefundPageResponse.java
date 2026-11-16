package com.fruitmachine.backend.payment.refund.dto;

import java.util.List;

public record RefundPageResponse(List<RefundResponse> content, int page, int size, long totalElements, int totalPages) {
}
