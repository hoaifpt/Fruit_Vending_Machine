package com.fruitmachine.backend.machine.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.machine.dto.event.MachineEventPageResponse;
import com.fruitmachine.backend.machine.enums.MachineEventSource;
import com.fruitmachine.backend.machine.service.MachineEventQueryService;
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
@RequestMapping(value = "/api/v1/machines/{machineId}/events", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = MachineEventController.TAG, description = MachineEventController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed machine UUID, invalid source, time range or paging", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks MACHINE_READ", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class MachineEventController {
    public static final String TAG = "Machine Events";
    public static final String TAG_DESCRIPTION = "History of each machine for ADMIN/STAFF with MACHINE_READ: every valid MQTT event and status message it sent "
            + "(source MACHINE, once per messageId) and the backend decisions about it (source BACKEND). Read-only evidence; heartbeats and "
            + "telemetry are not part of it.";

    private final MachineEventQueryService events;

    @GetMapping
    @PreAuthorize(Permissions.HAS_MACHINE_READ)
    @Operation(operationId = "listMachineEvents", summary = "Event timeline of a machine",
            description = "MACHINE_READ. Newest first (createdAt DESC, id DESC), filtered and paged in the database. type is an exact eventType, "
                    + "source MACHINE or BACKEND; from (inclusive) and to (exclusive) are optional ISO-8601 instants and to must be after from. "
                    + "page >= 0, size 1 to 200 (default 50). payload of MACHINE events is untrusted device data: render it escaped. "
                    + "Invalid parameters are 400 before the machine is looked up; a missing machine is 404.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of events")
    public ResponseEntity<ApiResponse<MachineEventPageResponse>> list(
            @PathVariable @Parameter(description = "Machine UUID.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "Optional exact eventType, for example FAULT or BACKEND_DISPENSE_FAILED.") String type,
            @RequestParam(required = false) @Parameter(description = "Optional MACHINE or BACKEND.") MachineEventSource source,
            @RequestParam(required = false) @Parameter(description = "Optional start, inclusive, ISO-8601 instant.", example = "2026-11-11T00:00:00Z") Instant from,
            @RequestParam(required = false) @Parameter(description = "Optional end, exclusive, ISO-8601 instant; after from.", example = "2026-11-12T00:00:00Z") Instant to,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "50") @Parameter(description = "Page size, 1 to 200.") int size) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Machine events retrieved", events.timeline(machineId, type, source, from, to, page, size)));
    }
}
