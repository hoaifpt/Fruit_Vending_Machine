package com.fruitmachine.backend.machine.kiosk.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.machine.kiosk.dto.KioskIdentityResponse;
import com.fruitmachine.backend.machine.kiosk.service.KioskIdentityService;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@PreAuthorize("hasRole('KIOSK')")
@SecurityRequirement(name = "kioskKey")
@Tag(name = "Kiosk", description = "Kiosk-facing APIs authenticated with the machine-bound X-Kiosk-Key header (not a user JWT). The machine is always derived from the credential.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing, malformed, unknown, revoked or wrong X-Kiosk-Key", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated as a user, not a kiosk", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class KioskIdentityController {
    private final KioskIdentityService identity;

    @GetMapping("/api/v1/kiosk/me")
    @Operation(operationId = "getKioskIdentity", summary = "Identify the machine of the current kiosk key",
            description = "KIOSK only. Lets the kiosk team verify a configured key. Works for INACTIVE or MAINTENANCE machines too; machine status is a business rule of catalog/order use cases.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Machine bound to the key")
    public ResponseEntity<ApiResponse<KioskIdentityResponse>> me(@AuthenticationPrincipal AuthenticatedKiosk kiosk) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Kiosk identity retrieved", identity.identity(kiosk)));
    }
}
