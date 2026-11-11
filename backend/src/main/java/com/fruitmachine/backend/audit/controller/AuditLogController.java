package com.fruitmachine.backend.audit.controller;

import com.fruitmachine.backend.audit.dto.AuditLogPageResponse;
import com.fruitmachine.backend.audit.dto.AuditLogResponse;
import com.fruitmachine.backend.audit.service.AuditLogQueryService;
import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.security.permission.Permissions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/audit-logs", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = AuditLogController.TAG, description = AuditLogController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed UUID, invalid time range or paging", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks AUDIT_LOG_READ", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class AuditLogController {
    public static final String TAG = "Audit Log";
    public static final String TAG_DESCRIPTION = "Read-only audit log (who changed what, and when) for AUDIT_LOG_READ, held by ADMIN. Entries are written by the "
            + "services that make the changes; there is no create, update or delete endpoint.";

    private final AuditLogQueryService audits;

    @GetMapping
    @PreAuthorize(Permissions.HAS_AUDIT_LOG_READ)
    @Operation(operationId = "listAuditLogs", summary = "Search the audit log",
            description = "AUDIT_LOG_READ. Newest first (createdAt DESC, id DESC), filtered and paged in the database. Every filter is optional: "
                    + "action and entityType are exact values, entityId and userId are UUIDs, from (inclusive) and to (exclusive) are ISO-8601 instants "
                    + "and to must be after from. page >= 0, size 1 to 200 (default 50). System changes have userId null and actor \"system\".")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of audit entries")
    public ResponseEntity<ApiResponse<AuditLogPageResponse>> list(
            @RequestParam(required = false) @Parameter(description = "Optional exact action, for example ROLE_PERMISSIONS_CHANGED.") String action,
            @RequestParam(required = false) @Parameter(description = "Optional exact entity type, for example Machine.") String entityType,
            @RequestParam(required = false) @Parameter(description = "Optional UUID of the changed record.") UUID entityId,
            @RequestParam(required = false) @Parameter(description = "Optional UUID of the acting user.") UUID userId,
            @RequestParam(required = false) @Parameter(description = "Optional start, inclusive, ISO-8601 instant.", example = "2026-11-11T00:00:00Z") Instant from,
            @RequestParam(required = false) @Parameter(description = "Optional end, exclusive, ISO-8601 instant; after from.", example = "2026-11-12T00:00:00Z") Instant to,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "50") @Parameter(description = "Page size, 1 to 200.") int size) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Audit log retrieved", audits.search(action, entityType, entityId, userId, from, to, page, size)));
    }

    @GetMapping("/{id}")
    @PreAuthorize(Permissions.HAS_AUDIT_LOG_READ)
    @Operation(operationId = "getAuditLog", summary = "Get one audit entry", description = "AUDIT_LOG_READ. One audit entry by UUID.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Audit entry"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Audit log entry not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<AuditLogResponse>> get(@PathVariable @Parameter(description = "Audit entry UUID.") UUID id) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Audit log entry retrieved", audits.get(id)));
    }
}
