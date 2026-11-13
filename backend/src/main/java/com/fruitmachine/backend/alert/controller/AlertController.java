package com.fruitmachine.backend.alert.controller;

import com.fruitmachine.backend.alert.dto.AlertPageResponse;
import com.fruitmachine.backend.alert.dto.AlertResponse;
import com.fruitmachine.backend.alert.dto.ResolveAlertRequest;
import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertStatus;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.alert.service.AlertService;
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
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/api/v1/alerts", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = AlertController.TAG, description = AlertController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed UUID, invalid filter, time range, paging or body", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks ALERT_READ / ALERT_MANAGE", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class AlertController {
    public static final String TAG = "Alerts";
    public static final String TAG_DESCRIPTION = "Machine and slot problems found by the 60 s health check, dispense failures and machine faults. One unresolved "
            + "alert per problem; the system resolves state-based alerts when the condition clears. ALERT_READ lists, ALERT_MANAGE acknowledges "
            + "and resolves (ADMIN and STAFF). Alerts are never created or deleted through the API.";

    private final AlertService alerts;

    @GetMapping
    @PreAuthorize(Permissions.HAS_ALERT_READ)
    @Operation(operationId = "listAlerts", summary = "List alerts",
            description = "ALERT_READ. Default status filter: OPEN and ACKNOWLEDGED; status selects exactly one status. Optional type, severity, "
                    + "machineId, slotId, errorCode and triggeredAt range (from inclusive, to exclusive, to after from). Sorted CRITICAL, WARNING, INFO, "
                    + "then newest first, id tie-break; paged in the database (page >= 0, size 1 to 200, default 50).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of alerts")
    public ResponseEntity<ApiResponse<AlertPageResponse>> list(
            @RequestParam(required = false) @Parameter(description = "Optional OPEN, ACKNOWLEDGED or RESOLVED; default OPEN and ACKNOWLEDGED.") AlertStatus status,
            @RequestParam(required = false) @Parameter(description = "Optional alert type.") AlertType type,
            @RequestParam(required = false) @Parameter(description = "Optional INFO, WARNING or CRITICAL.") AlertSeverity severity,
            @RequestParam(required = false) @Parameter(description = "Optional machine UUID.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "Optional slot UUID.") UUID slotId,
            @RequestParam(required = false) @Parameter(description = "Optional exact error code, for example SERVO_INIT_FAILED.") String errorCode,
            @RequestParam(required = false) @Parameter(description = "Optional start of triggeredAt, inclusive, ISO-8601.", example = "2026-11-13T00:00:00Z") Instant from,
            @RequestParam(required = false) @Parameter(description = "Optional end of triggeredAt, exclusive, ISO-8601; after from.", example = "2026-11-14T00:00:00Z") Instant to,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "50") @Parameter(description = "Page size, 1 to 200.") int size) {
        return ok("Alerts retrieved", alerts.search(status, type, severity, machineId, slotId, errorCode, from, to, page, size));
    }

    @GetMapping("/{id}")
    @PreAuthorize(Permissions.HAS_ALERT_READ)
    @Operation(operationId = "getAlert", summary = "Get one alert", description = "ALERT_READ. One alert by UUID, with machine and slot codes and actors.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Alert"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Alert not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<AlertResponse>> get(@PathVariable @Parameter(description = "Alert UUID.") UUID id) {
        return ok("Alert retrieved", alerts.get(id));
    }

    @PostMapping("/{id}/acknowledge")
    @PreAuthorize(Permissions.HAS_ALERT_MANAGE)
    @Operation(operationId = "acknowledgeAlert", summary = "Acknowledge an alert",
            description = "ALERT_MANAGE. OPEN -> ACKNOWLEDGED with the caller and time; acknowledging an ACKNOWLEDGED alert again returns it unchanged. "
                    + "A RESOLVED alert is 409. No request body.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Acknowledged alert"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Alert not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Alert is already resolved", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<AlertResponse>> acknowledge(@PathVariable @Parameter(description = "Alert UUID.") UUID id) {
        return ok("Alert acknowledged", alerts.acknowledge(id));
    }

    @PostMapping("/{id}/resolve")
    @PreAuthorize(Permissions.HAS_ALERT_MANAGE)
    @Operation(operationId = "resolveAlert", summary = "Resolve an alert",
            description = "ALERT_MANAGE. OPEN or ACKNOWLEDGED -> RESOLVED with the caller, time and an optional note (at most 500 characters; body optional). "
                    + "A RESOLVED alert is 409, also when the system resolved it a moment earlier. A state-based alert whose condition still holds is "
                    + "raised again as a new alert by the next health check.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Resolved alert"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Alert not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Alert is already resolved", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<AlertResponse>> resolve(@PathVariable @Parameter(description = "Alert UUID.") UUID id,
            @Valid @RequestBody(required = false) ResolveAlertRequest request) {
        return ok("Alert resolved", alerts.resolve(id, request == null ? null : request.note()));
    }

    private static <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
