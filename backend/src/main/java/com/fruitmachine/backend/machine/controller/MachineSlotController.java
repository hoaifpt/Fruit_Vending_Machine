package com.fruitmachine.backend.machine.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.machine.dto.slot.*;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import com.fruitmachine.backend.machine.service.MachineSlotService;
import io.swagger.v3.oas.annotations.*;
import io.swagger.v3.oas.annotations.media.*;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/api/v1/machines/{machineId}/slots", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Machine Slots", description = "Machine-scoped slot configuration. ACTIVE ADMIN/STAFF can read; ADMIN only can write. No stock or hardware API.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters, validation failure or malformed/unknown JSON fields", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks required role", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found or slot not found in the specified machine", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class MachineSlotController {
    private final MachineSlotService slots;

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    @Operation(operationId = "listMachineSlots", summary = "List slots belonging to a machine",
            description = "ADMIN or STAFF. Parent must exist; all parent machine statuses allow configuration reads. Database pagination with optional ACTIVE/INACTIVE/ERROR filter. "
                    + "Default page 0, size 20; size 1 to 100. Default slotCode,asc with UUID ascending tie-break. Out-of-range pages are empty, missing parent is 404.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Paginated slots in the requested machine")
    public ResponseEntity<ApiResponse<MachineSlotPageResponse>> list(
            @PathVariable @Parameter(description = "Owning machine UUID.") UUID machineId,
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size, 1 to 100.") int size,
            @RequestParam(required = false) @Parameter(description = "Optional ACTIVE, INACTIVE or ERROR slot status filter.") SlotStatus status,
            @RequestParam(defaultValue = "slotCode,asc") @Parameter(description = "One approved field: id, slotCode, capacity, status, createdAt, updatedAt; optional asc/desc (asc when omitted).") String sort) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Machine slots retrieved", slots.listSlots(machineId, page, size, status, sort)));
    }

    @GetMapping("/{slotId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    @Operation(operationId = "getMachineSlot", summary = "Get a slot in the specified machine",
            description = "ADMIN or STAFF. Looks up both machineId and slotId; cross-machine access returns 404. Returns only slot fields and parent UUID, no nested entities or inventory.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Slot configuration")
    public ResponseEntity<ApiResponse<MachineSlotResponse>> get(
            @PathVariable @Parameter(description = "Owning machine UUID.") UUID machineId,
            @PathVariable @Parameter(description = "Slot UUID belonging to the specified machine.") UUID slotId) {
        return success("Machine slot retrieved", slots.getSlot(machineId, slotId));
    }

    @PostMapping(consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "createMachineSlot", summary = "Configure a new machine slot",
            description = "ADMIN only. Parent must exist; INACTIVE/MAINTENANCE machines may be provisioned. Creates ACTIVE slot. "
                    + "Accepts only slotCode (nonblank, stripped/uppercase, at most 32 characters) and capacity (positive 32-bit JSON integer token; no string or decimal coercion). "
                    + "Code is immutable and unique per machine; another machine may reuse it. DB UNIQUE protects concurrent creates. No fixed slot count/capacity or inventory checks.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "ACTIVE slot created; Location points to the scoped slot"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Slot code already exists in this machine or concurrent UNIQUE conflict", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MachineSlotResponse>> create(
            @PathVariable @Parameter(description = "Owning machine UUID.") UUID machineId,
            @Valid @RequestBody CreateMachineSlotRequest request) {
        var slot = slots.createSlot(machineId, request);
        return ResponseEntity.created(URI.create("/api/v1/machines/" + machineId + "/slots/" + slot.id()))
                .header("Cache-Control", "no-store").body(ApiResponse.success("Machine slot created", slot));
    }

    @PutMapping(value = "/{slotId}", consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "updateMachineSlot", summary = "Replace slot capacity",
            description = "ADMIN only. Capacity must be a positive 32-bit JSON integer token; fractional numbers and numeric strings are rejected. "
                    + "slotCode/machineId/status/id/timestamps and unknown fields are rejected. Cross-machine access is 404. Preserves related records. "
                    + "Capacity is not stock; current occupancy validation is deferred to Inventory Management.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Updated slot capacity")
    public ResponseEntity<ApiResponse<MachineSlotResponse>> update(
            @PathVariable @Parameter(description = "Owning machine UUID.") UUID machineId,
            @PathVariable @Parameter(description = "Slot UUID belonging to the specified machine.") UUID slotId,
            @Valid @RequestBody UpdateMachineSlotRequest request) {
        return success("Machine slot updated", slots.updateSlot(machineId, slotId, request));
    }

    @PatchMapping(value = "/{slotId}/status", consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "updateMachineSlotStatus", summary = "Change slot status",
            description = "ADMIN only. Accepts only status string ACTIVE, INACTIVE or ERROR; numeric ordinals are rejected. Cross-machine access is 404. "
                    + "Same-status requests are idempotent. Does not change parent machine status, capacity, identity or related history. No automatic hardware detection or hard deletion.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Slot with current status")
    public ResponseEntity<ApiResponse<MachineSlotResponse>> status(
            @PathVariable @Parameter(description = "Owning machine UUID.") UUID machineId,
            @PathVariable @Parameter(description = "Slot UUID belonging to the specified machine.") UUID slotId,
            @Valid @RequestBody UpdateMachineSlotStatusRequest request) {
        return success("Machine slot status updated", slots.updateStatus(machineId, slotId, request));
    }

    private ResponseEntity<ApiResponse<MachineSlotResponse>> success(String message, MachineSlotResponse slot) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, slot));
    }
}
