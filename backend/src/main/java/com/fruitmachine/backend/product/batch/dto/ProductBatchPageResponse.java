package com.fruitmachine.backend.product.batch.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database page of batch DTOs; out-of-range pages have empty content.")
public record ProductBatchPageResponse(List<ProductBatchResponse> content, int page, int size, long totalElements, int totalPages) {}
