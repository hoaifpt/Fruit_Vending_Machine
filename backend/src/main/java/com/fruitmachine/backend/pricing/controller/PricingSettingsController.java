package com.fruitmachine.backend.pricing.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.pricing.dto.NearExpiryDiscountResponse;
import com.fruitmachine.backend.pricing.dto.UpdateNearExpiryDiscountRequest;
import com.fruitmachine.backend.pricing.service.PricingSettingsService;
import com.fruitmachine.backend.security.permission.Permissions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/api/v1/pricing", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = PricingSettingsController.TAG, description = PricingSettingsController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account; kiosk keys are not accepted", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks PRICING_READ / PRICING_MANAGE", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class PricingSettingsController {
    public static final String TAG = "Pricing";
    public static final String TAG_DESCRIPTION = "Near-expiry discount managed by Admin: a bowl whose batch expires on the current business day "
            + "(Asia/Ho_Chi_Minh) is sold at the configured percent, rounded down to whole VND. The price is locked when the order reserves "
            + "its bowl; changes affect new orders only. PRICING_READ (ADMIN, STAFF) views, PRICING_MANAGE (ADMIN) changes.";

    private final PricingSettingsService service;

    @GetMapping("/near-expiry-discount")
    @PreAuthorize(Permissions.HAS_PRICING_READ)
    @Operation(operationId = "getNearExpiryDiscount", summary = "Get the near-expiry discount", description = "PRICING_READ. Current setting with its version.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Current setting")
    public ResponseEntity<ApiResponse<NearExpiryDiscountResponse>> get() {
        return ok("Near-expiry discount retrieved", service.get());
    }

    @PutMapping(value = "/near-expiry-discount", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_PRICING_MANAGE)
    @Operation(operationId = "updateNearExpiryDiscount", summary = "Change the near-expiry discount",
            description = "PRICING_MANAGE. enabled and percent (integer 1 to 90) replace the setting when version matches the stored one; "
                    + "otherwise 409. Same values: 200, version unchanged, no audit row. A change writes one audit_logs row "
                    + "PRICING_NEAR_EXPIRY_UPDATED and applies at once to the catalog and new orders; existing orders never change.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Setting after the change"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Missing field, percent outside 1..90 or not an integer, unknown field, malformed JSON", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Stale version: changed by someone else", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<NearExpiryDiscountResponse>> update(@RequestBody UpdateNearExpiryDiscountRequest request) {
        return ok("Near-expiry discount updated", service.update(request));
    }

    private static <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
