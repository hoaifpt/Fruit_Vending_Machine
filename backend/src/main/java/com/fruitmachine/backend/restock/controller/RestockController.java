package com.fruitmachine.backend.restock.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.restock.dto.*;
import com.fruitmachine.backend.restock.service.RestockExecutionService;
import com.fruitmachine.backend.restock.service.RestockPlanningService;
import com.fruitmachine.backend.restock.service.RestockSuggestionService;
import com.fruitmachine.backend.restock.service.RestockViewService;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.workorder.dto.RestockLineInput;
import com.fruitmachine.backend.workorder.dto.WorkOrderResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
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
@Tag(name = RestockController.TAG, description = RestockController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed UUID or body, slot of another machine, quantity above capacity, not a RESTOCK work order", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account; kiosk keys are not accepted", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks RESTOCK_PLAN / RESTOCK_EXECUTE / WORK_ORDER_READ_ASSIGNED", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class RestockController {
    public static final String TAG = "Restock";
    public static final String TAG_DESCRIPTION = "Restock workflow on RESTOCK work orders: Admin (RESTOCK_PLAN) gets per-slot suggestions and plans lines; the assignee "
            + "(RESTOCK_EXECUTE) loads bowls against a line of the IN_PROGRESS work order (history references the line); completion compares planned and "
            + "loaded. Direct POST /api/v1/inventory/load is ADMIN only. 409 messages start with a code: RESTOCK_WITHOUT_LINES, LINE_ALREADY_LOADED, "
            + "DUPLICATE_LINE, SLOT_INACTIVE, PRODUCT_INACTIVE, NOTHING_TO_RESTOCK, WORK_ORDER_NOT_IN_PROGRESS, BATCH_PRODUCT_MISMATCH, BATCH_EXPIRED, "
            + "EXPIRY_INVERSION, SLOT_CAPACITY_EXCEEDED, BATCH_QUANTITY_EXCEEDED, RESTOCK_VARIANCE_REASON_REQUIRED, REFILL_GATE_OPEN.";

    private final RestockSuggestionService suggestions;
    private final RestockPlanningService planning;
    private final RestockExecutionService execution;
    private final RestockViewService views;

    @GetMapping("/api/v1/machines/{machineId}/restock-suggestions")
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    @Operation(operationId = "getRestockSuggestions", summary = "Restock suggestions of a machine",
            description = "RESTOCK_PLAN. Per slot: counts, head status, current product, open alerts and NONE / LOAD / EMPTY_THEN_LOAD with a load quantity. "
                    + "One aggregate query; nothing is locked.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Suggestions"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<RestockSuggestionResponse>> suggestions(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId) {
        return ok("Restock suggestions retrieved", suggestions.suggestions(machineId));
    }

    @PostMapping(value = "/api/v1/machines/{machineId}/restock-work-orders", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    @Operation(operationId = "createRestockWorkOrderFromSuggestions", summary = "Create a RESTOCK work order from suggestions",
            description = "RESTOCK_PLAN (with WORK_ORDER_MANAGE). Lines for every slot whose suggestion is not NONE and whose product is known; open stock alerts "
                    + "of those slots linked. Nothing to restock: 409 NOTHING_TO_RESTOCK.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Work order created"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Nothing to restock or machine inactive", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<WorkOrderResponse>> fromSuggestions(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId,
            @RequestBody CreateRestockWorkOrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store")
                .body(ApiResponse.success("Restock work order created", planning.createFromSuggestions(machineId, request)));
    }

    @PostMapping(value = "/api/v1/work-orders/{id}/restock-lines", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    @Operation(operationId = "addRestockLine", summary = "Add a restock line", description = "RESTOCK_PLAN. RESTOCK work order not DONE / CANCELLED.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Line after the change"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order, line, slot or product not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Finished work order, line already loaded, duplicate line, inactive slot or product", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<RestockLineResponse>> addLine(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @RequestBody RestockLineInput request) {
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store").body(ApiResponse.success("Restock line added", planning.addLine(id, request)));
    }

    @PatchMapping(value = "/api/v1/work-orders/{id}/restock-lines/{lineId}", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    @Operation(operationId = "updateRestockLine", summary = "Change a restock line", description = "RESTOCK_PLAN. Only while nothing was loaded against it (409 LINE_ALREADY_LOADED).")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Line after the change"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order, line, slot or product not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Finished work order, line already loaded, duplicate line, inactive slot or product", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<RestockLineResponse>> updateLine(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @PathVariable @Parameter(description = "Line UUID.") UUID lineId, @RequestBody UpdateRestockLineRequest request) {
        return ok("Restock line updated", planning.updateLine(id, lineId, request));
    }

    @DeleteMapping("/api/v1/work-orders/{id}/restock-lines/{lineId}")
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    @Operation(operationId = "deleteRestockLine", summary = "Delete a restock line", description = "RESTOCK_PLAN. Only while nothing was loaded against it.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Line after the change"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order, line, slot or product not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Finished work order, line already loaded, duplicate line, inactive slot or product", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<Void>> deleteLine(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @PathVariable @Parameter(description = "Line UUID.") UUID lineId) {
        planning.deleteLine(id, lineId);
        return ok("Restock line deleted", null);
    }

    @PostMapping(value = "/api/v1/work-orders/{id}/restock-lines/{lineId}/loads", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_RESTOCK_EXECUTE)
    @Operation(operationId = "loadRestockLine", summary = "Load bowls against a restock line",
            description = "RESTOCK_EXECUTE, assignee (or Admin) of the IN_PROGRESS RESTOCK work order. Batch of the line's product, valid beyond the reservation "
                    + "hold; slot ACTIVE or ERROR; capacity and the batch's declared quantity; a batch expiring earlier than bowls already in the column is "
                    + "409 EXPIRY_INVERSION unless acknowledged. Creates AVAILABLE bowls with strictly increasing loaded_at and LOAD history referencing the line.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Bowls loaded"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order, line or batch not found, or work order of someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "A loading rule does not hold (code at the start of the message)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<RestockLoadResponse>> load(@PathVariable @Parameter(description = "Work order UUID.") UUID id,
            @PathVariable @Parameter(description = "Line UUID.") UUID lineId, @RequestBody RestockLoadRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store").body(ApiResponse.success("Bowls loaded", execution.load(id, lineId, request)));
    }

    @GetMapping("/api/v1/work-orders/{id}/restock")
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ASSIGNED)
    @Operation(operationId = "getRestock", summary = "Restock view of a work order",
            description = "WORK_ORDER_READ_ASSIGNED, same visibility as the work order. Lines with loads, linked maintenance commands and removed bowls by reason.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Restock view"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Work order not found or not RESTOCK", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<RestockViewResponse>> view(@PathVariable @Parameter(description = "Work order UUID.") UUID id) {
        return ok("Restock retrieved", views.view(id));
    }

    private static <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
