package com.fruitmachine.backend.workorder.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.workorder.dto.*;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.enums.WorkOrderSource;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.util.List;
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
@Tag(name = WorkOrderController.TAG, description = WorkOrderController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed UUID, invalid filter, paging or body", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account; kiosk keys are not accepted", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks the WORK_ORDER_* permission of the operation", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class WorkOrderController {
    public static final String TAG = "Work Orders";
    public static final String TAG_DESCRIPTION = "Jobs Staff do at a machine: RESTOCK, MAINTENANCE, INCIDENT. Admin (WORK_ORDER_MANAGE) creates, edits, assigns, "
            + "cancels; the assignee (WORK_ORDER_EXECUTE) starts and completes; Admin may act for them. OPEN -> ASSIGNED -> IN_PROGRESS -> DONE, "
            + "CANCELLED before DONE. Starting RESTOCK / MAINTENANCE (INCIDENT on request) puts the machine in MAINTENANCE; only an Admin reactivates it, "
            + "and not while a work order is IN_PROGRESS. Without WORK_ORDER_READ_ALL, work orders assigned to others are 404. "
            + "409 messages start with a code: INVALID_WORK_ORDER_TRANSITION, STALE_VERSION, MACHINE_INACTIVE, MACHINE_HAS_ACTIVE_ORDERS, "
            + "MACHINE_COMMAND_IN_PROGRESS, ALERT_ALREADY_HANDLED, ALERT_RESOLVED.";

    private final WorkOrderService service;

    @PostMapping(value = "/api/v1/work-orders", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    @Operation(operationId = "createWorkOrder", summary = "Create a work order",
            description = "WORK_ORDER_MANAGE. Source MANUAL; OPEN without assignee, ASSIGNED (assignee notified) with one. Machine must exist and not be "
                    + "INACTIVE (409 MACHINE_INACTIVE); dueAt not in the past.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Work order created"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Machine inactive", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> create(@RequestBody CreateWorkOrderRequest request) {
        return created("Work order created", service.create(request));
    }

    @PostMapping(value = "/api/v1/alerts/{alertId}/work-orders", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    @Operation(operationId = "createWorkOrderFromAlert", summary = "Create a work order for an alert",
            description = "WORK_ORDER_MANAGE. Source ALERT, the alert's machine, linked to the alert; an OPEN alert becomes ACKNOWLEDGED. Defaults come "
                    + "from the alert. A RESOLVED alert is 409 ALERT_RESOLVED; an alert already handled by an unfinished work order is 409 ALERT_ALREADY_HANDLED "
                    + "(the message names that work order). Body optional.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Work order created"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Alert not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Alert resolved or already handled", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> createFromAlert(@PathVariable @Parameter(description = "Alert UUID.") UUID alertId,
            @RequestBody(required = false) CreateWorkOrderFromAlertRequest request) {
        return created("Work order created", service.createFromAlert(alertId, request));
    }

    @GetMapping("/api/v1/work-orders")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ALL)
    @Operation(operationId = "listWorkOrders", summary = "List work orders",
            description = "WORK_ORDER_READ_ALL. Filters: status (repeatable), type, source, machineId, assigneeId, priority, overdue=true, createdAt range "
                    + "(from inclusive, to exclusive). Sorted URGENT, HIGH, NORMAL, LOW, then due time (none last), then oldest; page >= 0, size 1 to 100 (default 20).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of work orders")
    public ResponseEntity<ApiResponse<WorkOrderPageResponse>> list(
            @RequestParam(required = false) @Parameter(description = "Optional statuses (repeat the parameter); default all.") List<WorkOrderStatus> status,
            @RequestParam(required = false) @Parameter(description = "Optional type.") WorkOrderType type,
            @RequestParam(required = false) @Parameter(description = "Optional source.") WorkOrderSource source,
            @RequestParam(required = false) @Parameter(description = "Optional machine UUID.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "Optional assignee UUID.") UUID assigneeId,
            @RequestParam(required = false) @Parameter(description = "Optional priority.") WorkOrderPriority priority,
            @RequestParam(defaultValue = "false") @Parameter(description = "true: only unfinished work orders past their due time.") boolean overdue,
            @RequestParam(required = false) @Parameter(description = "Optional start of createdAt, inclusive, ISO-8601.") Instant from,
            @RequestParam(required = false) @Parameter(description = "Optional end of createdAt, exclusive, ISO-8601; after from.") Instant to,
            @RequestParam(required = false) @Parameter(description = "Issue #70: optional maintenance plan UUID (SCHEDULE work orders of that plan).") UUID maintenancePlanId,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Parameter(description = "Page size, 1 to 100.") int size) {
        return ok("Work orders retrieved", service.list(status, type, source, machineId, assigneeId, priority, overdue, from, to, maintenancePlanId, page, size));
    }

    @GetMapping("/api/v1/work-orders/me")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ASSIGNED)
    @Operation(operationId = "listMyWorkOrders", summary = "List my work orders",
            description = "WORK_ORDER_READ_ASSIGNED. Work orders assigned to the caller; optional status (repeatable) and overdue; same order and paging as the full list.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of work orders")
    public ResponseEntity<ApiResponse<WorkOrderPageResponse>> mine(
            @RequestParam(required = false) @Parameter(description = "Optional statuses (repeat the parameter); default all.") List<WorkOrderStatus> status,
            @RequestParam(defaultValue = "false") @Parameter(description = "true: only unfinished work orders past their due time.") boolean overdue,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Parameter(description = "Page size, 1 to 100.") int size) {
        return ok("Work orders retrieved", service.mine(status, overdue, page, size));
    }

    @GetMapping("/api/v1/work-orders/{id}")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ASSIGNED)
    @Operation(operationId = "getWorkOrder", summary = "Get one work order",
            description = "WORK_ORDER_READ_ASSIGNED; without WORK_ORDER_READ_ALL only the caller's own work orders (others are 404). Includes linked alerts and version.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> get(@PathVariable @Parameter(description = "Work order UUID.") UUID id) {
        return ok("Work order retrieved", service.get(id));
    }

    @GetMapping("/api/v1/work-orders/{id}/events")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ASSIGNED)
    @Operation(operationId = "listWorkOrderEvents", summary = "Work order history", description = "Same visibility as the detail. Oldest first; append-only.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "History"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<List<WorkOrderEventResponse>>> events(@PathVariable @Parameter(description = "Work order UUID.") UUID id) {
        return ok("Work order history retrieved", service.events(id));
    }

    @PatchMapping(value = "/api/v1/work-orders/{id}", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    @Operation(operationId = "updateWorkOrder", summary = "Edit a work order",
            description = "WORK_ORDER_MANAGE. title, description, priority, dueAt of an unfinished work order; stale version 409 STALE_VERSION. No change: 200 without history.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> update(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody UpdateWorkOrderRequest request) {
        return ok("Work order updated", service.update(id, request));
    }

    @PostMapping(value = "/api/v1/work-orders/{id}/assign", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    @Operation(operationId = "assignWorkOrder", summary = "Assign or reassign",
            description = "WORK_ORDER_MANAGE. OPEN -> ASSIGNED; ASSIGNED and IN_PROGRESS keep their status with the new assignee, who is notified.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> assign(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody AssignWorkOrderRequest request) {
        return ok("Work order assigned", service.assign(id, request));
    }

    @PostMapping(value = "/api/v1/work-orders/{id}/unassign", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    @Operation(operationId = "unassignWorkOrder", summary = "Unassign", description = "WORK_ORDER_MANAGE. ASSIGNED -> OPEN.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> unassign(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody VersionRequest request) {
        return ok("Work order unassigned", service.unassign(id, request));
    }

    @PostMapping("/api/v1/work-orders/{id}/start")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_EXECUTE)
    @Operation(operationId = "startWorkOrder", summary = "Start a work order",
            description = "WORK_ORDER_EXECUTE, assignee (or Admin). ASSIGNED -> IN_PROGRESS; again: 200 unchanged. RESTOCK / MAINTENANCE (INCIDENT with "
                    + "stopMachine) put an ACTIVE machine in MAINTENANCE: 409 MACHINE_HAS_ACTIVE_ORDERS / MACHINE_COMMAND_IN_PROGRESS while customers are served; "
                    + "an INACTIVE machine is 409 MACHINE_INACTIVE. Body optional.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> start(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody(required = false) StartWorkOrderRequest request) {
        return ok("Work order started", service.start(id, request));
    }

    @PostMapping(value = "/api/v1/work-orders/{id}/notes", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_EXECUTE)
    @Operation(operationId = "addWorkOrderNote", summary = "Add a note", description = "WORK_ORDER_EXECUTE, assignee (or Admin); unfinished work orders only.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> note(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody WorkOrderNoteRequest request) {
        return ok("Note added", service.addNote(id, request));
    }

    @PostMapping(value = "/api/v1/work-orders/{id}/complete", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_EXECUTE)
    @Operation(operationId = "completeWorkOrder", summary = "Complete a work order",
            description = "WORK_ORDER_EXECUTE, assignee (or Admin). IN_PROGRESS -> DONE with resultNote; 409 MACHINE_COMMAND_IN_PROGRESS while a maintenance "
                    + "command runs. Linked OPEN/ACKNOWLEDGED alerts are resolved (resolveLinkedAlerts, default true). The machine stays MAINTENANCE.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> complete(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody CompleteWorkOrderRequest request) {
        return ok("Work order completed", service.complete(id, request));
    }

    @PostMapping(value = "/api/v1/work-orders/{id}/cancel", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    @Operation(operationId = "cancelWorkOrder", summary = "Cancel a work order",
            description = "WORK_ORDER_MANAGE. Any unfinished status -> CANCELLED with a reason; the machine status is not changed.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> cancel(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody CancelWorkOrderRequest request) {
        return ok("Work order cancelled", service.cancel(id, request));
    }

    @PostMapping(value = "/api/v1/work-orders/{id}/alerts", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    @Operation(operationId = "linkWorkOrderAlert", summary = "Link an alert",
            description = "WORK_ORDER_MANAGE. An unresolved alert of the same machine (another machine: 400) not handled by another unfinished work order.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> link(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody LinkAlertRequest request) {
        return ok("Alert linked", service.linkAlert(id, request));
    }

    @DeleteMapping("/api/v1/work-orders/{id}/alerts/{alertId}")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    @Operation(operationId = "unlinkWorkOrderAlert", summary = "Unlink an alert", description = "WORK_ORDER_MANAGE. Not after DONE or CANCELLED.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Work order after the action"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order (or linked alert) not found, or assigned to someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, stale version or machine precondition (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> unlink(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @PathVariable @Parameter(description = "Alert UUID.") UUID alertId) {
        return ok("Alert unlinked", service.unlinkAlert(id, alertId));
    }

    private static <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }

    private static <T> ResponseEntity<ApiResponse<T>> created(String message, T data) {
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
