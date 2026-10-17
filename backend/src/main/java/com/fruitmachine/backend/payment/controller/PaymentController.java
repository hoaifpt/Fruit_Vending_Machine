package com.fruitmachine.backend.payment.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.payment.dto.PaymentDetailResponse;
import com.fruitmachine.backend.payment.dto.PaymentPageResponse;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import com.fruitmachine.backend.payment.service.PaymentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
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
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@PreAuthorize("hasRole('ADMIN')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Payments", description = "Read-only payment management for ADMIN. There is no write, delete or status endpoint; no client can mark a payment successful.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token (a kiosk key is not accepted here)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account is not ADMIN", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class PaymentController {
    private final PaymentService payments;

    @GetMapping("/api/v1/payments")
    @Operation(operationId = "listPayments", summary = "List and filter payment attempts",
            description = "ADMIN only. Database pagination page0/size20/max100. Filters combine: status, provider (normalized to uppercase), orderId, machineId (through the order), createdFrom (inclusive), createdTo (exclusive). "
                    + "Approved sorts createdAt (default desc), amount, paidAt, each with a UUID tie-break. Items never include the QR payload.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Database page of payment summaries")
    public ResponseEntity<ApiResponse<PaymentPageResponse>> list(
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size 1..100.") int size,
            @RequestParam(required = false) @Parameter(description = "Exact stored payment status.") PaymentStatus status,
            @RequestParam(required = false) @Parameter(description = "Provider code, case-insensitive, for example MOCK.") String provider,
            @RequestParam(required = false) @Parameter(description = "Order UUID filter.") UUID orderId,
            @RequestParam(required = false) @Parameter(description = "Machine UUID filter, resolved through the order.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "ISO-8601 instant, inclusive lower bound of createdAt.") Instant createdFrom,
            @RequestParam(required = false) @Parameter(description = "ISO-8601 instant, exclusive upper bound of createdAt.") Instant createdTo,
            @RequestParam(required = false) @Parameter(description = "true returns SUCCESS payments that need human review: the order was CANCELLED (late payment) or another SUCCESS payment exists for the same order (duplicate payment, both are listed and the later one is the refund candidate). Amount mismatches leave the payment unchanged, so they are found through the webhook logs and audit_logs.") Boolean requiresAttention,
            @RequestParam(defaultValue = "createdAt,desc") @Parameter(description = "One of createdAt, amount, paidAt with optional asc/desc.") String sort) {
        return ok("Payments retrieved", payments.listPayments(page, size, status, provider, orderId, machineId, createdFrom, createdTo, requiresAttention, sort));
    }

    @GetMapping("/api/v1/payments/{id}")
    @Operation(operationId = "getPayment", summary = "Get payment attempt details",
            description = "ADMIN only. The list fields plus the QR payload (qrCode).")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Payment details"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Payment not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<PaymentDetailResponse>> get(@PathVariable @Parameter(description = "Payment UUID.") UUID id) {
        return ok("Payment retrieved", payments.getPayment(id));
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
