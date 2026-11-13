package com.fruitmachine.backend.payment.refund.dto;

import java.util.List;

public record RefundCandidatePageResponse(List<RefundCandidateResponse> content, int page, int size, long totalElements, int totalPages) {
}
