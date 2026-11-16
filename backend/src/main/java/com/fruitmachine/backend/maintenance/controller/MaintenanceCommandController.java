package com.fruitmachine.backend.maintenance.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.maintenance.dto.CreateMaintenanceCommandRequest;
import com.fruitmachine.backend.maintenance.dto.MaintenanceCommandPageResponse;
import com.fruitmachine.backend.maintenance.dto.MaintenanceCommandResponse;
import com.fruitmachine.backend.maintenance.dto.ReconcileMaintenanceCommandRequest;
import com.fruitmachine.backend.maintenance.dto.ResetMachineRequest;
import com.fruitmachine.backend.maintenance.enums.MaintenanceCommandStatus;
import com.fruitmachine.backend.maintenance.enums.MaintenanceOperation;
import com.fruitmachine.backend.maintenance.service.MaintenanceCommandService;
import com.fruitmachine.backend.security.permission.Permissions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = MaintenanceCommandController.TAG, description = MaintenanceCommandController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed UUID, invalid filter, paging, body or Idempotency-Key", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account; kiosk keys are not accepted", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks MAINTENANCE_COMMAND_READ / MAINTENANCE_COMMAND_EXECUTE / MACHINE_RESET", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class MaintenanceCommandController {
    public static final String TAG = "Maintenance Commands";
    public static final String TAG_DESCRIPTION = "Remote column maintenance while a machine is in MAINTENANCE: remove the head bowl, empty a column, open or close "
            + "the refill gate (Staff/Admin), and RESET of a controller fault (Admin). One unfinished command per machine; dispense and maintenance never "
            + "overlap. Inventory changes only when the machine reports COMPLETED, or when Staff reconciles an uncertain command as DONE. "
            + "409 messages start with a code: MACHINE_NOT_IN_MAINTENANCE, MACHINE_COMMAND_IN_PROGRESS, MACHINE_OFFLINE, SLOT_HAS_RESERVED_ITEM, "
            + "SLOT_EMPTY, NOT_HEAD_ITEM, HEAD_NOT_REMOVABLE, REFILL_GATE_OPEN, IDEMPOTENCY_KEY_REUSED, NOT_RECONCILABLE, EFFECT_NOT_POSSIBLE.";
    private static final String IDEMPOTENCY = "Idempotency-Key";

    private final MaintenanceCommandService service;

    @PostMapping(value = "/api/v1/machines/{machineId}/slots/{slotId}/maintenance-commands", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_COMMAND_EXECUTE)
    @Operation(operationId = "createMaintenanceCommand", summary = "Send a maintenance command to one column",
            description = "MAINTENANCE_COMMAND_EXECUTE. Machine in MAINTENANCE and online, no unfinished maintenance or running dispense command, "
                    + "no RESERVED bowl in the column. REMOVE_ITEM takes the head bowl (AVAILABLE, EXPIRED or DISPENSE_FAILED) only; REMOVE_ITEM and "
                    + "EMPTY_COLUMN need the refill gate closed and a reason; OPEN_REFILL needs it closed; CLOSE_REFILL is always allowed. "
                    + "Same Idempotency-Key and body: 200 with the existing command; same key, other body: 409 IDEMPOTENCY_KEY_REUSED.",
            parameters = @Parameter(name = IDEMPOTENCY, in = ParameterIn.HEADER, required = true, description = "8 to 64 characters of A-Z, a-z, 0-9, _ or -.",
                    schema = @Schema(type = "string", pattern = "^[A-Za-z0-9_-]{8,64}$")))
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Command created (PENDING)"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Existing command for this Idempotency-Key"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine or slot not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "A precondition does not hold (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenanceCommandResponse>> create(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId,
            @PathVariable @Parameter(description = "Slot UUID of that machine.") UUID slotId,
            @RequestHeader(value = IDEMPOTENCY, required = false) @Parameter(hidden = true) String idempotencyKey,
            @RequestBody CreateMaintenanceCommandRequest request) {
        var result = service.create(machineId, slotId, idempotencyKey, request);
        return respond(result.created(), result.created() ? "Maintenance command created" : "Maintenance command already exists", result.command());
    }

    @PostMapping("/api/v1/machines/{machineId}/reset")
    @PreAuthorize(Permissions.HAS_MACHINE_RESET)
    @Operation(operationId = "resetMachine", summary = "Clear a controller fault (RESET)",
            description = "MACHINE_RESET (Admin). Same preconditions as other maintenance commands, no column. The machine answers RESET_ACCEPTED "
                    + "(command COMPLETED) or RESET_REJECTED; FAULT_CLEARED then resolves the CONTROLLER_FAULT alert. The machine stays MAINTENANCE.",
            parameters = @Parameter(name = IDEMPOTENCY, in = ParameterIn.HEADER, required = true, description = "8 to 64 characters of A-Z, a-z, 0-9, _ or -.",
                    schema = @Schema(type = "string", pattern = "^[A-Za-z0-9_-]{8,64}$")))
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "RESET command created (PENDING)"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Existing command for this Idempotency-Key"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "A precondition does not hold (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenanceCommandResponse>> reset(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId,
            @RequestHeader(value = IDEMPOTENCY, required = false) @Parameter(hidden = true) String idempotencyKey,
            @RequestBody(required = false) ResetMachineRequest request) {
        var result = service.reset(machineId, idempotencyKey, request);
        return respond(result.created(), result.created() ? "Reset command created" : "Reset command already exists", result.command());
    }

    @GetMapping("/api/v1/maintenance-commands")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_COMMAND_READ)
    @Operation(operationId = "listMaintenanceCommands", summary = "List maintenance commands",
            description = "MAINTENANCE_COMMAND_READ. Optional machineId, slotId, operation, status and createdAt range (from inclusive, to exclusive); "
                    + "newest first; paged in the database (page >= 0, size 1 to 100, default 20).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of commands")
    public ResponseEntity<ApiResponse<MaintenanceCommandPageResponse>> list(
            @RequestParam(required = false) @Parameter(description = "Optional machine UUID.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "Optional slot UUID.") UUID slotId,
            @RequestParam(required = false) @Parameter(description = "Optional operation.") MaintenanceOperation operation,
            @RequestParam(required = false) @Parameter(description = "Optional status.") MaintenanceCommandStatus status,
            @RequestParam(required = false) @Parameter(description = "Optional start of createdAt, inclusive, ISO-8601.") Instant from,
            @RequestParam(required = false) @Parameter(description = "Optional end of createdAt, exclusive, ISO-8601; after from.") Instant to,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Parameter(description = "Page size, 1 to 100.") int size) {
        return ok("Maintenance commands retrieved", service.list(machineId, slotId, operation, status, from, to, page, size));
    }

    @GetMapping("/api/v1/maintenance-commands/{id}")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_COMMAND_READ)
    @Operation(operationId = "getMaintenanceCommand", summary = "Get one maintenance command", description = "MAINTENANCE_COMMAND_READ.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Command"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Command not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenanceCommandResponse>> get(@PathVariable @Parameter(description = "Command UUID.") UUID id) {
        return ok("Maintenance command retrieved", service.get(id));
    }

    @PostMapping(value = "/api/v1/maintenance-commands/{id}/reconcile", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_COMMAND_EXECUTE)
    @Operation(operationId = "reconcileMaintenanceCommand", summary = "Reconcile an uncertain maintenance command",
            description = "MAINTENANCE_COMMAND_EXECUTE. Only NEEDS_RECONCILIATION (aborted, no result in time, head changed). DONE applies the effect "
                    + "(409 EFFECT_NOT_POSSIBLE when the head bowl is no longer the target); NOT_DONE changes nothing. Both end RECONCILED with an "
                    + "audit_logs row; a second reconcile is 409 NOT_RECONCILABLE.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Reconciled command"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Command not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Not reconcilable or effect no longer possible", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenanceCommandResponse>> reconcile(@PathVariable @Parameter(description = "Command UUID.") UUID id,
            @RequestBody ReconcileMaintenanceCommandRequest request) {
        return ok("Maintenance command reconciled", service.reconcile(id, request));
    }

    private static <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }

    private static <T> ResponseEntity<ApiResponse<T>> respond(boolean created, String message, T data) {
        return ResponseEntity.status(created ? HttpStatus.CREATED : HttpStatus.OK).header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
