package com.fruitmachine.backend.user.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database-paginated accounts, ordered by createdAt descending then UUID ascending.")
public record UserPageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<UserResponse> content,
        @Schema(description = "Zero-based page index.", minimum = "0", requiredMode = Schema.RequiredMode.REQUIRED) int page,
        @Schema(description = "Requested page size.", minimum = "1", maximum = "100", requiredMode = Schema.RequiredMode.REQUIRED) int size,
        @Schema(description = "Total matching accounts.", minimum = "0", requiredMode = Schema.RequiredMode.REQUIRED) long totalElements,
        @Schema(description = "Total pages.", minimum = "0", requiredMode = Schema.RequiredMode.REQUIRED) int totalPages) { }
