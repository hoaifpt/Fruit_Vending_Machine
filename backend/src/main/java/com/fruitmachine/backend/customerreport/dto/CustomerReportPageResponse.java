package com.fruitmachine.backend.customerreport.dto;

import java.util.List;

public record CustomerReportPageResponse(List<CustomerReportSummaryResponse> content, int page, int size, long totalElements, int totalPages) {
}
