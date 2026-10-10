package com.fruitmachine.backend.inventory.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.inventory.dto.*;
import com.fruitmachine.backend.inventory.enums.*;
import com.fruitmachine.backend.inventory.service.InventoryService;
import io.swagger.v3.oas.annotations.*;
import io.swagger.v3.oas.annotations.media.*;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController @RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Inventory", description = "Management of individual physical boxes. ACTIVE ADMIN/STAFF read/load/remove confirmed stock. No order/payment/reservation/dispense workflows.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters, malformed/unknown JSON or validation failure", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks ADMIN/STAFF role", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Requested item, batch, machine or scoped slot not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class InventoryController {
    private final InventoryService inventory;
    @PostMapping(value = "/api/v1/inventory/load", consumes = "application/json")
    @Operation(operationId = "loadInventory", summary = "Record physically confirmed stock loading",
            description = "ADMIN or STAFF. Creates N AVAILABLE items and N append-only LOAD rows in one transaction. Product ACTIVE, batch unexpired, Machine ACTIVE/MAINTENANCE and Slot ACTIVE required. "
                    + "Physical occupancy includes AVAILABLE/RESERVED/EXPIRED/DISPENSE_FAILED. Total registered batch items include all statuses. "
                    + "Lock order Product/Batch/Machine/Slot serializes state and count checks. Quantity 1..1000 per bounded bulk request, strict JSON integer. "
                    + "Actor is current principal. Operation UUID groups per-item history using reference_id; not an idempotency key. Retries may register more boxes if limits permit. No hardware action.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "N boxes and N per-item history rows registered"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Ineligible product/batch/machine/slot, capacity/batch quantity exceeded or database conflict", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<InventoryLoadResponse>> load(@Valid @RequestBody LoadInventoryRequest request) {
        return ResponseEntity.status(201).header("Cache-Control", "no-store").body(ApiResponse.success("Inventory loaded", inventory.loadInventory(request)));
    }
    @PostMapping(value = "/api/v1/inventory/{id}/remove", consumes = "application/json")
    @Operation(operationId = "removeInventory", summary = "Record confirmed physical removal",
            description = "ADMIN or STAFF. AVAILABLE/EXPIRED -> REMOVED only, with removedAt. Reject RESERVED/SOLD/REMOVED/DISPENSE_FAILED; failed dispense requires a separate reconciliation flow. "
                    + "Locks Slot then Item, preserves last location and original batch quantity. One atomic REMOVE history row stores actor, reason and before/after status snapshots. No deletion or arbitrary status changes.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Item retained as REMOVED"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition or database conflict", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<InventoryItemResponse>> remove(@PathVariable @Parameter(description = "Inventory item UUID.") UUID id, @Valid @RequestBody RemoveInventoryRequest request) {
        return ok("Inventory removed", inventory.removeInventoryItem(id, request));
    }
    @GetMapping("/api/v1/inventory")
    @Operation(operationId = "listInventory", summary = "List/filter physical inventory",
            description = "ADMIN or STAFF. Combined exact machine/slot/batch/status filters and optional batch-time expired filter (all statuses). Unknown filter IDs produce empty pages. "
                    + "Database pagination page0/size20/max100 with to-one graph, no collection paging. One approved sort id/status/loadedAt/createdAt/updatedAt, default createdAt,desc plus UUID ascending tie-break. Legacy off-machine rows supported.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Database page of safe item DTOs")
    public ResponseEntity<ApiResponse<InventoryPageResponse>> list(
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size 1..100.") int size,
            @RequestParam(required = false) @Parameter(description = "Machine UUID filter.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "Slot UUID filter.") UUID slotId,
            @RequestParam(required = false) @Parameter(description = "Batch UUID filter.") UUID batchId,
            @RequestParam(required = false) @Parameter(description = "Exact stored inventory status.") InventoryStatus status,
            @RequestParam(required = false) @Parameter(description = "Derived batch expiry <= now when true, > now when false; does not change status.") Boolean expired,
            @RequestParam(defaultValue = "createdAt,desc") @Parameter(description = "One approved field id/status/loadedAt/createdAt/updatedAt, optional asc/desc; asc when omitted.") String sort) {
        return ok("Inventory retrieved", inventory.listInventory(page, size, machineId, slotId, batchId, status, expired, sort));
    }
    @GetMapping("/api/v1/inventory/{id}")
    @Operation(operationId = "getInventory", summary = "Get physical item details", description = "ADMIN or STAFF. Safe item/batch/product/location DTO, including historical SOLD/REMOVED and legacy off-machine items. UTC expiry and derived expired flag; no recursive entities or credentials.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Inventory item details")
    public ResponseEntity<ApiResponse<InventoryItemResponse>> get(@PathVariable @Parameter(description = "Inventory item UUID.") UUID id) { return ok("Inventory item retrieved", inventory.getInventoryItem(id)); }
    @GetMapping("/api/v1/machines/{machineId}/inventory")
    @Operation(operationId = "listMachineInventory", summary = "List inventory in a machine", description = "ADMIN or STAFF. Existing machine required. Database page scoped through item slot FK to machine, including retained historical locations. Default createdAt,desc with UUID tie-break.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Machine-scoped inventory page")
    public ResponseEntity<ApiResponse<InventoryPageResponse>> machine(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId,
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) InventoryStatus status, @RequestParam(required = false) Boolean expired) {
        return ok("Machine inventory retrieved", inventory.getMachineInventory(machineId, page, size, status, expired));
    }
    @GetMapping("/api/v1/machines/{machineId}/slots/{slotId}/inventory")
    @Operation(operationId = "listSlotInventory", summary = "List inventory in a scoped slot", description = "ADMIN or STAFF. Machine must exist and slot must belong to it; cross-machine slot returns404. Database page including retained historical locations. Default createdAt,desc with UUID tie-break.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Scoped slot inventory page")
    public ResponseEntity<ApiResponse<InventoryPageResponse>> slot(@PathVariable UUID machineId, @PathVariable UUID slotId,
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) InventoryStatus status, @RequestParam(required = false) Boolean expired) {
        return ok("Slot inventory retrieved", inventory.getSlotInventory(machineId, slotId, page, size, status, expired));
    }
    @GetMapping("/api/v1/machines/{machineId}/slots/{slotId}/inventory/summary")
    @Operation(operationId = "getSlotInventorySummary", summary = "Get physical/available/sellable slot counts", description = "ADMIN or STAFF. Scoped machine/slot validation. DB aggregates at asOf, no stock counters: occupied includes AVAILABLE/RESERVED/EXPIRED/DISPENSE_FAILED; available requires AVAILABLE+unexpired; sellable additionally ACTIVE product/machine/slot. ExpiredCount includes physically present boxes with past batch expiry or EXPIRED status. Remaining capacity=max(0,capacity-occupied).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Derived slot stock summary")
    public ResponseEntity<ApiResponse<InventorySummaryResponse>> summary(@PathVariable UUID machineId, @PathVariable UUID slotId) { return ok("Inventory summary retrieved", inventory.getInventorySummary(machineId, slotId)); }
    @GetMapping("/api/v1/inventory/transactions")
    @Operation(operationId = "listInventoryTransactions", summary = "List append-only per-item inventory history", description = "ADMIN or STAFF. DB pagination page0/size20/max100, createdAt,desc with UUID tie-break; optional exact filters. N loaded boxes produce N LOAD rows sharing referenceId. Snapshot location/actor/status/reason returned, nullable for legacy rows; each row represents one box. No history mutation endpoints.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Inventory history page")
    public ResponseEntity<ApiResponse<InventoryTransactionPageResponse>> transactions(
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) UUID inventoryItemId, @RequestParam(required = false) UUID machineId,
            @RequestParam(required = false) UUID slotId, @RequestParam(required = false) UUID referenceId,
            @RequestParam(required = false) InventoryTransactionType type) {
        return ok("Inventory transactions retrieved", inventory.listInventoryTransactions(page, size, inventoryItemId, machineId, slotId, referenceId, type));
    }
    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) { return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data)); }
}
