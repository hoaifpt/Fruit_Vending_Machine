package com.fruitmachine.backend.audit.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database page of audit entries, newest first (createdAt DESC, then id DESC).")
public record AuditLogPageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Entries of this page.") List<AuditLogResponse> content,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Zero-based page index.") int page,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Requested page size.") int size,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Matching entries.") long totalElements,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Pages of matching entries.") int totalPages) { }
