package com.fruitmachine.backend.order.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.order.dto.CreateOrderRequest;
import com.fruitmachine.backend.order.dto.KioskOrderResponse;
import com.fruitmachine.backend.order.service.OrderService;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@PreAuthorize("hasRole('KIOSK')")
@SecurityRequirement(name = "kioskKey")
@Tag(name = "Kiosk Orders", description = "Kiosk order creation with atomic bowl reservation, own-order read and cancel. Only PENDING_PAYMENT and CANCELLED are produced; no payment, QR or dispensing.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing, malformed, unknown, revoked or wrong X-Kiosk-Key", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated as a user, not a kiosk", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class KioskOrderController {
    private final OrderService orders;

    @PostMapping(value = "/api/v1/kiosk/orders", consumes = "application/json")
    @Operation(operationId = "createKioskOrder", summary = "Create an order and reserve bowls",
            description = "KIOSK only. All-or-nothing in one transaction: locks products and the machine (shared), selects FEFO bowls of this machine with SKIP LOCKED whose batch outlives the hold deadline, "
                    + "snapshots server-side prices, creates a PENDING_PAYMENT order with expiresAt = now + reservation TTL and reserves the bowls with RESERVE history. Machine, prices and status are never accepted from the client.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Order created and bowls reserved"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Validation failure: empty/duplicate lines, quantity < 1 or fractional, total above maximum, unknown fields", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Unknown product", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Inactive product, machine not ACTIVE or insufficient sellable quantity; nothing reserved", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<KioskOrderResponse>> create(@AuthenticationPrincipal AuthenticatedKiosk kiosk,
            @Valid @RequestBody CreateOrderRequest request) {
        return ResponseEntity.status(201).header("Cache-Control", "no-store")
                .body(ApiResponse.success("Order created", orders.createOrder(kiosk, request)));
    }

    @GetMapping("/api/v1/kiosk/orders/{orderId}")
    @Operation(operationId = "getKioskOrder", summary = "Get an order of this machine",
            description = "KIOSK only. Returns the stored status and expiresAt; reads never write, so an overdue PENDING_PAYMENT order stays PENDING_PAYMENT until the sweep runs. Another machine's order returns 404.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Order of this machine"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Missing order or order of another machine", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<KioskOrderResponse>> get(@AuthenticationPrincipal AuthenticatedKiosk kiosk,
            @PathVariable @Parameter(description = "Order UUID.") UUID orderId) {
        return ok("Order retrieved", orders.getKioskOrder(kiosk, orderId));
    }

    @PostMapping("/api/v1/kiosk/orders/{orderId}/cancel")
    @Operation(operationId = "cancelKioskOrder", summary = "Cancel a pending order and release its bowls",
            description = "KIOSK only. PENDING_PAYMENT becomes CANCELLED and every RESERVED bowl returns to AVAILABLE with RETURN history (reason ORDER_CANCELLED). Cancelling a CANCELLED order returns 200 unchanged. Other states return 409; another machine's order returns 404.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Order is CANCELLED"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Missing order or order of another machine", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Order is not PENDING_PAYMENT or CANCELLED", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<KioskOrderResponse>> cancel(@AuthenticationPrincipal AuthenticatedKiosk kiosk,
            @PathVariable @Parameter(description = "Order UUID.") UUID orderId) {
        return ok("Order cancelled", orders.cancelKioskOrder(kiosk, orderId));
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
