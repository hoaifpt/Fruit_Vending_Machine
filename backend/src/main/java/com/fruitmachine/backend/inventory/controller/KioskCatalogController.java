package com.fruitmachine.backend.inventory.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.inventory.dto.KioskCatalogResponse;
import com.fruitmachine.backend.inventory.service.KioskCatalogService;
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
public class KioskCatalogController {
    private final KioskCatalogService catalog;

    @GetMapping("/api/v1/kiosk/catalog")
    @Operation(operationId = "getKioskCatalog", summary = "List sellable products of the kiosk machine",
            description = "KIOSK only. Products that can be dispensed now: an ACTIVE product listed only when at least one ACTIVE slot of this machine has a sellable head of it "
                    + "(the bottom bowl of the column is AVAILABLE and its batch expires after the reservation hold deadline). A product whose slots are all blocked by a RESERVED, EXPIRED, DISPENSE_FAILED or expiring head is not listed. "
                    + "A machine that is not ACTIVE returns acceptingOrders=false and no products. availableQuantity is a display snapshot, not a reservation. No slot, item or batch identifiers are exposed; one order buys one bowl.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Sellable catalog")
    public ResponseEntity<ApiResponse<KioskCatalogResponse>> catalog(@AuthenticationPrincipal AuthenticatedKiosk kiosk) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Kiosk catalog retrieved", catalog.catalog(kiosk)));
    }
}
