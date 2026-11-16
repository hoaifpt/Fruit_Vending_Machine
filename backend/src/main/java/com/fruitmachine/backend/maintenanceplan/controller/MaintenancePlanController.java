package com.fruitmachine.backend.maintenanceplan.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.maintenanceplan.dto.*;
import com.fruitmachine.backend.maintenanceplan.service.MaintenancePlanService;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.workorder.dto.WorkOrderResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/api/v1/maintenance-plans", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = MaintenancePlanController.TAG, description = MaintenancePlanController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed UUID, invalid body, interval/lead, dates or paging", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account; kiosk keys are not accepted", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks MAINTENANCE_PLAN_READ / MAINTENANCE_PLAN_MANAGE", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class MaintenancePlanController {
    public static final String TAG = "Maintenance Plans";
    public static final String TAG_DESCRIPTION = "Recurring maintenance per machine: every intervalDays the system creates one MAINTENANCE work order (source SCHEDULE) "
            + "leadDays before the due date, due at dueTime (Asia/Ho_Chi_Minh), assigned to the default assignee or announced to managers. Completing it moves "
            + "the next due date to completion date + interval; cancelling skips the occurrence. MAINTENANCE_PLAN_READ (ADMIN, STAFF) reads, "
            + "MAINTENANCE_PLAN_MANAGE (ADMIN) changes; every change is audited. Plans are deactivated, never deleted.";

    private final MaintenancePlanService service;

    @PostMapping(consumes = "application/json")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    @Operation(operationId = "createMaintenancePlan", summary = "Create a maintenance plan",
            description = "MAINTENANCE_PLAN_MANAGE. Machine not INACTIVE (409 MACHINE_INACTIVE); interval 1..365, lead 0..30 and below the interval; firstDueDate today "
                    + "or later (default today + interval); default assignee ACTIVE with WORK_ORDER_EXECUTE.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Plan created"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Machine inactive", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenancePlanResponse>> create(@RequestBody CreateMaintenancePlanRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store").body(ApiResponse.success("Maintenance plan created", service.create(request)));
    }

    @GetMapping
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_READ)
    @Operation(operationId = "listMaintenancePlans", summary = "List maintenance plans",
            description = "MAINTENANCE_PLAN_READ. Optional machineId and active; by next due date; page >= 0, size 1 to 100 (default 20).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of plans")
    public ResponseEntity<ApiResponse<MaintenancePlanPageResponse>> list(
            @RequestParam(required = false) @Parameter(description = "Optional machine UUID.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "Optional true / false.") Boolean active,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Parameter(description = "Page size, 1 to 100.") int size) {
        return ok("Maintenance plans retrieved", service.list(machineId, active, page, size));
    }

    @GetMapping("/upcoming")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_READ)
    @Operation(operationId = "listUpcomingMaintenance", summary = "Upcoming maintenance",
            description = "MAINTENANCE_PLAN_READ. Active plans due within days (1 to 90, default 30; overdue ones included), with their unfinished work orders, by date.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Upcoming plans")
    public ResponseEntity<ApiResponse<List<MaintenancePlanResponse>>> upcoming(
            @RequestParam(defaultValue = "30") @Parameter(description = "Days ahead, 1 to 90.") int days,
            @RequestParam(required = false) @Parameter(description = "Optional machine UUID.") UUID machineId) {
        return ok("Upcoming maintenance retrieved", service.upcoming(days, machineId));
    }

    @GetMapping("/{id}")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_READ)
    @Operation(operationId = "getMaintenancePlan", summary = "Get one maintenance plan", description = "MAINTENANCE_PLAN_READ.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Found"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Plan not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenancePlanResponse>> get(@PathVariable @Parameter(description = "Plan UUID.") UUID id) {
        return ok("Maintenance plan retrieved", service.get(id));
    }

    @GetMapping("/{id}/work-orders")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_READ)
    @Operation(operationId = "listMaintenancePlanWorkOrders", summary = "Work orders of a plan", description = "MAINTENANCE_PLAN_READ. Newest occurrence first.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Found"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Plan not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<List<PlanWorkOrderResponse>>> workOrders(@PathVariable @Parameter(description = "Plan UUID.") UUID id) {
        return ok("Maintenance plan work orders retrieved", service.workOrders(id));
    }

    @PatchMapping(value = "/{id}", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    @Operation(operationId = "updateMaintenancePlan", summary = "Change a maintenance plan",
            description = "MAINTENANCE_PLAN_MANAGE. Partial; version required (stale 409 STALE_VERSION). nextDueDate today or later; changing intervalDays does not "
                    + "move nextDueDate. No change: 200 without an audit row.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Plan after the change"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Plan not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Stale version", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenancePlanResponse>> update(@PathVariable @Parameter(description = "Plan UUID.") UUID id,
            @RequestBody UpdateMaintenancePlanRequest request) {
        return ok("Maintenance plan updated", service.update(id, request));
    }

    @PostMapping("/{id}/activate")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    @Operation(operationId = "activateMaintenancePlan", summary = "Activate a plan", description = "MAINTENANCE_PLAN_MANAGE. Idempotent.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Plan after the change"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Plan not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Stale version", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenancePlanResponse>> activate(@PathVariable @Parameter(description = "Plan UUID.") UUID id) {
        return ok("Maintenance plan activated", service.setActive(id, true));
    }

    @PostMapping("/{id}/deactivate")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    @Operation(operationId = "deactivateMaintenancePlan", summary = "Deactivate a plan",
            description = "MAINTENANCE_PLAN_MANAGE. Idempotent. No new work orders; existing ones stay linked (plans are never deleted).")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Plan after the change"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Plan not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Stale version", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MaintenancePlanResponse>> deactivate(@PathVariable @Parameter(description = "Plan UUID.") UUID id) {
        return ok("Maintenance plan deactivated", service.setActive(id, false));
    }

    @PostMapping("/{id}/generate-now")
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    @Operation(operationId = "generateMaintenancePlanWorkOrder", summary = "Create the plan's work order now",
            description = "MAINTENANCE_PLAN_MANAGE. The current occurrence regardless of lead days. 409 MAINTENANCE_PLAN_INACTIVE, PLAN_HAS_OPEN_WORK_ORDER, "
                    + "OCCURRENCE_ALREADY_GENERATED or MACHINE_INACTIVE.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Work order created"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Plan not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Plan inactive, unfinished work order, occurrence generated or machine inactive", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> generateNow(@PathVariable @Parameter(description = "Plan UUID.") UUID id) {
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store").body(ApiResponse.success("Work order created", service.generateNow(id)));
    }

    private static <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
