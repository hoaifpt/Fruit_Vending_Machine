package com.fruitmachine.backend.payment.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.payment.dto.KioskPaymentResponse;
import com.fruitmachine.backend.payment.service.PaymentService;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@PreAuthorize("hasRole('KIOSK')")
@SecurityRequirement(name = "kioskKey")
@Tag(name = "Kiosk Payments", description = "Kiosk payment attempts (QR) for its own PENDING_PAYMENT orders. This API never reports payment success; only a verified provider webhook (a later issue) can do that.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing, malformed, unknown, revoked or wrong X-Kiosk-Key", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated as a user, not a kiosk", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class KioskPaymentController {
    private final PaymentService payments;

    @PostMapping("/api/v1/kiosk/orders/{orderId}/payments")
    @Operation(operationId = "createKioskPayment", summary = "Create or reuse a payment attempt (QR) for an order",
            description = "KIOSK only, no request body. The amount is always the order total. A live PENDING attempt with a QR is reused (200); otherwise a new attempt is created (201): "
                    + "step 1 validates and inserts in a transaction, step 2 calls the configured provider with no transaction open, step 3 records the result. "
                    + "The attempt deadline is min(order expiresAt, now + attempt TTL), so a QR never outlives the reservation. Poll GET /api/v1/kiosk/orders/{orderId} every 2-3 seconds for status. "
                    + "Provider failure or timeout marks the attempt FAILED and returns 502; the order is unchanged. "
                    + "With provider PAYOS the qrCode is a VietQR payload and only whole-VND amounts are accepted: a fractional order amount (for example 35000.50) is never rounded and returns 409 before any attempt is created.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "New attempt created with a QR"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Existing live attempt reused"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Missing order or order of another machine", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Order not PENDING_PAYMENT, hold almost expired, attempt creation in flight, maximum attempts reached, order amount not chargeable by the provider (for example non-integer VND for PAYOS) or order cancelled during the provider call", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "502", description = "Payment provider failed or timed out; the attempt is FAILED", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<KioskPaymentResponse>> create(@AuthenticationPrincipal AuthenticatedKiosk kiosk,
            @PathVariable @Parameter(description = "Order UUID of this machine.") UUID orderId) {
        var result = payments.createOrReuseAttempt(kiosk, orderId);
        return ResponseEntity.status(result.created() ? 201 : 200).header("Cache-Control", "no-store")
                .body(ApiResponse.success(result.created() ? "Payment attempt created" : "Payment attempt reused", result.payment()));
    }
}
