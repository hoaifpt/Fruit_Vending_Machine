package com.fruitmachine.backend.dispense.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.dispense.dto.*;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping(value = "/api/v1/kiosk", produces = "application/json")
@PreAuthorize("hasRole('KIOSK')")
@SecurityRequirement(name = "kioskKey")
@Tag(name = "Kiosk Dispensing", description = "Machine-scoped fulfillment after verified payment. A station exclusively claims a persisted command, relays the assigned slot over Serial/USB and reports its correlated observation. Never retry hardware after an ambiguous result.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Operation succeeded", useReturnTypeSchema = true),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed UUID, invalid body or observation", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing or invalid kiosk key", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "User JWT cannot act as kiosk", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Missing resource or resource owned by another machine", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Invalid transition, expired bowl, wrong claim or machine busy; never blindly resend a motor command", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class KioskDispenseController {
    private final DispenseService service;

    @ModelAttribute
    void preventCaching(jakarta.servlet.http.HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
    }

    @PostMapping("/orders/{orderId}/dispense-command")
    @Operation(operationId = "prepareKioskDispense", summary = "Create or reuse the authorized command for a PAID order",
            description = "KIOSK only. Idempotent by order; price, inventory and slot are selected by backend, not the request. Exactly one reserved bowl is supported. Expired bowls are refused. Returns the same command on repeated calls, including terminal commands.")
    public ApiResponse<DispenseCommandResponse> prepare(@AuthenticationPrincipal @Parameter(hidden = true) AuthenticatedKiosk kiosk,
            @PathVariable UUID orderId) {
        return ApiResponse.success("Dispense command authorized", service.prepare(kiosk, orderId));
    }

    @GetMapping("/orders/{orderId}/dispense-command")
    @Operation(operationId = "getKioskDispense", summary = "Read the owning order's command",
            description = "KIOSK only. Read-only status for the purchase UI; never contains dispatchToken and never moves hardware. 404 before a command exists.")
    public ApiResponse<DispenseCommandResponse> get(@AuthenticationPrincipal @Parameter(hidden = true) AuthenticatedKiosk kiosk,
            @PathVariable UUID orderId) {
        return ApiResponse.success("Dispense command", service.get(kiosk, orderId));
    }

    @GetMapping("/dispense-commands")
    @Operation(operationId = "listPendingKioskDispenses", summary = "List up to 20 pending commands for this machine",
            description = "KIOSK station worker only. Ordered by createdAt then id; no claims, secrets or hardware side effects. Stations must serialize all physical columns sharing one IR sensor.")
    public ApiResponse<List<DispenseCommandResponse>> pending(@AuthenticationPrincipal @Parameter(hidden = true) AuthenticatedKiosk kiosk) {
        return ApiResponse.success("Pending dispense commands", service.pending(kiosk));
    }

    @PostMapping("/dispense-commands/{commandId}/claim")
    @Operation(operationId = "claimKioskDispense", summary = "Exclusively claim physical dispatch once",
            description = "KIOSK station worker only. Rechecks PAID, machine/slot ACTIVE and bowl expiry, persists SENT, changes order to DISPENSING and returns dispatchToken once. One in-flight command per machine. Repeated/lost claims return 409; no takeover and no hardware resend.")
    public ApiResponse<DispenseClaimResponse> claim(@AuthenticationPrincipal @Parameter(hidden = true) AuthenticatedKiosk kiosk,
            @PathVariable UUID commandId) {
        return ApiResponse.success("Dispatch exclusively claimed", service.claim(kiosk, commandId));
    }

    @PostMapping(value = "/dispense-commands/{commandId}/results", consumes = "application/json")
    @Operation(operationId = "reportKioskDispenseResult", summary = "Report correlated ACK or terminal physical observation",
            description = "KIOSK station worker only, with the claim token. ACK is not completion. SUCCESS requires exactly one IR count increment and the station's completed idle cycle observation; atomically marks command SUCCESS, allocation DISPENSED, bowl SOLD, order COMPLETED and appends SALE history. FAILED/TIMEOUT quarantine the bowl and put the machine in MAINTENANCE. Identical terminal retries are idempotent; conflicting/late transitions return 409. Unknown outcomes require staff reconciliation, no automatic refund or re-dispense.")
    public ApiResponse<DispenseCommandResponse> result(@AuthenticationPrincipal @Parameter(hidden = true) AuthenticatedKiosk kiosk,
            @PathVariable UUID commandId, @Valid @RequestBody DispenseResultRequest request) {
        return ApiResponse.success("Dispense observation recorded", service.result(kiosk, commandId, request));
    }
}
