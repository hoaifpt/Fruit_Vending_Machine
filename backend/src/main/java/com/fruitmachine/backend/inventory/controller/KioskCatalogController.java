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
            description = "KIOSK only. Products with at least one sellable bowl: AVAILABLE, loaded in an ACTIVE slot of this machine, batch expiring after the reservation hold deadline, ACTIVE product. "
                    + "A machine that is not ACTIVE returns acceptingOrders=false and no products. availableQuantity is a snapshot, not a reservation. No slot, item or batch identifiers are exposed.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Sellable catalog")
    public ResponseEntity<ApiResponse<KioskCatalogResponse>> catalog(@AuthenticationPrincipal AuthenticatedKiosk kiosk) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Kiosk catalog retrieved", catalog.catalog(kiosk)));
    }
}
