package com.fruitmachine.backend.machine.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.machine.dto.*;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.service.MachineService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
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
@RequestMapping(value = "/api/v1/machines", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Machines", description = "Machine management. ACTIVE ADMIN/STAFF can read; ADMIN only can write. No public kiosk API.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters, validation failure or malformed/unknown JSON fields", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks the required role", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class MachineController {
    private final MachineService machines;

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    @Operation(operationId = "listMachines", summary = "List/search machines",
            description = "ADMIN or STAFF. Database pagination with combined optional status and case-insensitive literal substring search on code/name/location. "
                    + "Default page 0, size 20; maximum size 100. One sort field/direction using Spring conventions, default createdAt,desc; UUID ascending tie-break. "
                    + "All three statuses are visible by default; out-of-range pages are empty.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Paginated machines")
    public ResponseEntity<ApiResponse<MachinePageResponse>> list(
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size, 1 to 100.") int size,
            @RequestParam(required = false) @Parameter(description = "Optional ACTIVE, INACTIVE or MAINTENANCE filter.") MachineStatus status,
            @RequestParam(required = false) @Size(max = 200) @Parameter(description = "Optional literal substring of code/name/location, case-insensitive, stripped; blank means no filter. Maximum 200 characters.") String search,
            @RequestParam(defaultValue = "createdAt,desc") @Parameter(description = "One approved field: id, code, name, location, status, createdAt, updatedAt; optional asc/desc (asc when omitted). Example name,asc.") String sort) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Machines retrieved", machines.listMachines(page, size, status, search, sort)));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    @Operation(operationId = "getMachine", summary = "Get machine details",
            description = "ADMIN or STAFF. Returns machine configuration fields for an existing UUID, including INACTIVE machines; no slot/inventory/sensor collections.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Machine configuration"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MachineResponse>> get(@PathVariable @Parameter(description = "Machine UUID.") UUID id) {
        return success("Machine retrieved", machines.getMachine(id));
    }

    @PostMapping(consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "createMachine", summary = "Register machine",
            description = "ADMIN only. Creates INACTIVE machine with stripped/uppercased unique code and null lastSeenAt. "
                    + "Only code/name/location/minTemperature/maxTemperature/minHumidity/maxHumidity are accepted. Status/id/lastSeenAt/timestamps/slot fields are rejected. "
                    + "Temperature bounds -100 to 100 Celsius; humidity 0 to 100 percent; minima strictly below maxima; at most two decimal places, never rounded. Database UNIQUE protects concurrent creates.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "INACTIVE machine created; Location points to the machine"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "code already exists or concurrent database uniqueness conflict", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MachineResponse>> create(@Valid @RequestBody CreateMachineRequest request) {
        var machine = machines.createMachine(request);
        return ResponseEntity.created(URI.create("/api/v1/machines/" + machine.id())).header("Cache-Control", "no-store")
                .body(ApiResponse.success("Machine created", machine));
    }

    @PutMapping(value = "/{id}", consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "updateMachine", summary = "Replace machine configuration",
            description = "ADMIN only. Replaces required name/location and four environmental thresholds. Minimum must be strictly below maximum; schema bounds and two decimal places enforced. "
                    + "code/status/id/lastSeenAt/timestamps are rejected. Preserves slots, sensor history and all related records.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Updated machine configuration"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MachineResponse>> update(@PathVariable @Parameter(description = "Machine UUID.") UUID id,
            @Valid @RequestBody UpdateMachineRequest request) {
        return success("Machine updated", machines.updateMachine(id, request));
    }

    @PatchMapping(value = "/{id}/status", consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "updateMachineStatus", summary = "Change administrative machine status",
            description = "ADMIN only. Sets ACTIVE, INACTIVE or MAINTENANCE, preserving identity and all related history. INACTIVE disables future operational use, not deletion. "
                    + "Same-status requests are idempotent. No slot/inventory/IoT changes or hard deletion.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Machine with current administrative status"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MachineResponse>> status(@PathVariable @Parameter(description = "Machine UUID.") UUID id,
            @Valid @RequestBody UpdateMachineStatusRequest request) {
        return success("Machine status updated", machines.updateStatus(id, request));
    }

    private ResponseEntity<ApiResponse<MachineResponse>> success(String message, MachineResponse machine) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, machine));
    }
}
