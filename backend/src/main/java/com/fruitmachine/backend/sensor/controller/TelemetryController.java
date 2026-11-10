package com.fruitmachine.backend.sensor.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.sensor.dto.TelemetryLatestResponse;
import com.fruitmachine.backend.sensor.dto.TelemetryPageResponse;
import com.fruitmachine.backend.sensor.service.TelemetryQueryService;
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
@RequestMapping(value = "/api/v1/machines/{machineId}/telemetry", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = TelemetryController.TAG, description = TelemetryController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed machine UUID, missing/invalid time range or invalid paging", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks MACHINE_READ", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class TelemetryController {
    public static final String TAG = "Machine Health";
    public static final String TAG_DESCRIPTION = "Temperature/humidity readings sent by the machines over MQTT (telemetry channel), for ADMIN/STAFF "
            + "with MACHINE_READ. Machine connectivity and controller diagnostics are part of the Machines responses. Display only: no alerts.";

    private final TelemetryQueryService telemetry;

    @GetMapping("/latest")
    @PreAuthorize(Permissions.HAS_MACHINE_READ)
    @Operation(operationId = "getLatestTelemetry", summary = "Latest telemetry reading of a machine",
            description = "MACHINE_READ. Latest reading by receive time (recordedAt, then id), each value compared with the machine thresholds: "
                    + "below the minimum LOW, above the maximum HIGH, otherwise NORMAL; a missing value has a null status. "
                    + "No reading yet: 200 with null reading fields. Includes the derived connectivity. Display only, not an alert.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Latest reading, or null reading fields")
    public ResponseEntity<ApiResponse<TelemetryLatestResponse>> latest(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Latest telemetry retrieved", telemetry.latest(machineId)));
    }

    @GetMapping
    @PreAuthorize(Permissions.HAS_MACHINE_READ)
    @Operation(operationId = "listTelemetry", summary = "Telemetry history of a machine",
            description = "MACHINE_READ. Readings with from <= recordedAt < to, newest first (recordedAt DESC, id DESC), paged in the database. "
                    + "from and to are required ISO-8601 instants, to must be after from and the range at most 31 days; page >= 0, size 1 to 500 "
                    + "(default 100). Invalid parameters are 400 before the machine is looked up; a missing machine is 404.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of readings")
    public ResponseEntity<ApiResponse<TelemetryPageResponse>> history(
            @PathVariable @Parameter(description = "Machine UUID.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "Required. Start of the range, inclusive, ISO-8601 instant.", example = "2026-11-10T00:00:00Z") Instant from,
            @RequestParam(required = false) @Parameter(description = "Required. End of the range, exclusive, ISO-8601 instant; after from, at most 31 days later.", example = "2026-11-11T00:00:00Z") Instant to,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "100") @Parameter(description = "Page size, 1 to 500.") int size) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Telemetry retrieved", telemetry.history(machineId, from, to, page, size)));
    }
}
