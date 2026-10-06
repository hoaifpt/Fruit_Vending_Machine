package com.fruitmachine.backend.product.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database-paginated catalog matching combined status/search filters.")
public record ProductPageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ProductResponse> content,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Zero-based page index.") int page,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1", maximum = "100", description = "Requested page size.") int size,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Total matching products.") long totalElements,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Total pages.") int totalPages) { }
