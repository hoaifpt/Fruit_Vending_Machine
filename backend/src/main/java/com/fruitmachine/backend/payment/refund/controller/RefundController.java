package com.fruitmachine.backend.payment.refund.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.payment.dto.PaymentDetailResponse;
import com.fruitmachine.backend.payment.enums.RefundReason;
import com.fruitmachine.backend.payment.refund.dto.RefundCandidatePageResponse;
import com.fruitmachine.backend.payment.refund.dto.RefundCandidateType;
import com.fruitmachine.backend.payment.refund.dto.RefundPageResponse;
import com.fruitmachine.backend.payment.refund.dto.RefundPaymentRequest;
import com.fruitmachine.backend.payment.refund.dto.RefundSummaryResponse;
import com.fruitmachine.backend.payment.refund.service.RefundQueryService;
import com.fruitmachine.backend.payment.refund.service.RefundService;
import com.fruitmachine.backend.security.permission.Permissions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@Validated
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Refunds", description = "Manual refunds (issue #72): the administrator transfers the money in the banking app and records it here; "
        + "no provider refund API is called. ADMIN only (PAYMENT_REFUND, REFUND_READ); STAFF has no access to payments.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters or body", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token (a kiosk key is not accepted here)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Missing the refund permission", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class RefundController {
    private final RefundService refunds;
    private final RefundQueryService queries;

    @PostMapping(path = "/api/v1/payments/{paymentId}/refund", consumes = "application/json")
    @PreAuthorize(Permissions.HAS_PAYMENT_REFUND)
    @Operation(operationId = "refundPayment", summary = "Record a manual refund of a payment",
            description = "PAYMENT_REFUND (ADMIN). The money was already transferred; the amount is always the payment amount. SUCCESS -> REFUNDED with the "
                    + "transfer reference, reason and note; the order becomes REFUNDED only when this is its paying payment (the first money that arrived) "
                    + "and the order is DISPENSE_FAILED or COMPLETED. Reasons: DISPENSE_FAILED (order DISPENSE_FAILED, paying payment), LATE_PAYMENT "
                    + "(order CANCELLED, stays CANCELLED), DUPLICATE_PAYMENT (an earlier payment of the order exists; order unchanged), PRODUCT_QUALITY "
                    + "(order COMPLETED, paying payment), OTHER (COMPLETED or DISPENSE_FAILED, paying payment, note required). One audit_logs row "
                    + "PAYMENT_REFUNDED with actor and IP. workOrderId optionally adds a NOTE to an INCIDENT work order. Inventory is never changed.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Payment detail with the refund block"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Payment not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "PAYMENT_ALREADY_REFUNDED, REFUND_TRANSFER_REF_USED, DISPENSE_IN_PROGRESS (order PAID/DISPENSING or an unfinished dispense command), REFUND_REASON_MISMATCH or PAYMENT_NOT_REFUNDABLE (not SUCCESS), as the message prefix", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<PaymentDetailResponse>> refund(@PathVariable @Parameter(description = "Payment UUID.") UUID paymentId,
            @Valid @RequestBody RefundPaymentRequest request) {
        return ok("Refund recorded", refunds.refund(paymentId, request));
    }

    @GetMapping("/api/v1/refunds/candidates")
    @PreAuthorize(Permissions.HAS_REFUND_READ)
    @Operation(operationId = "listRefundCandidates", summary = "Payments waiting for a refund",
            description = "REFUND_READ (ADMIN). SUCCESS payments of finished orders: LATE_PAYMENT (order CANCELLED), DUPLICATE_PAYMENT (an earlier payment of the order "
                    + "exists), DISPENSE_FAILED (order DISPENSE_FAILED, paying payment). CUSTOMER_REPORT is reserved and returns nothing yet. Refunded payments disappear. "
                    + "payer comes from the verified webhook of the payment only (null when the provider did not send it). Oldest waiting first; from/to are "
                    + "business-zone dates of paidAt (inclusive).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of refund candidates")
    public ResponseEntity<ApiResponse<RefundCandidatePageResponse>> candidates(
            @RequestParam(required = false) @Parameter(description = "Candidate type filter.") RefundCandidateType type,
            @RequestParam(required = false) @Parameter(description = "Machine UUID filter.") UUID machineId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First business-zone day (inclusive).") LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last business-zone day (inclusive).") LocalDate to,
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size 1..100.") int size) {
        return ok("Refund candidates retrieved", queries.candidates(type, machineId, from, to, page, size));
    }

    @GetMapping("/api/v1/refunds")
    @PreAuthorize(Permissions.HAS_REFUND_READ)
    @Operation(operationId = "listRefunds", summary = "List recorded refunds",
            description = "REFUND_READ (ADMIN). REFUNDED payments, newest refund first. from/to are business-zone dates of refundedAt (inclusive).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of refunds")
    public ResponseEntity<ApiResponse<RefundPageResponse>> list(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First business-zone day (inclusive).") LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last business-zone day (inclusive).") LocalDate to,
            @RequestParam(required = false) @Parameter(description = "Refund reason filter.") RefundReason reason,
            @RequestParam(required = false) @Parameter(description = "Machine UUID filter.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "UUID of the administrator who recorded the refund.") UUID refundedBy,
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size 1..100.") int size) {
        return ok("Refunds retrieved", queries.list(from, to, reason, machineId, refundedBy, page, size));
    }

    @GetMapping("/api/v1/refunds/summary")
    @PreAuthorize(Permissions.HAS_REFUND_READ)
    @Operation(operationId = "getRefundSummary", summary = "Refund totals",
            description = "REFUND_READ (ADMIN). Count and total amount of refunds, overall and by reason, by business-zone date of refundedAt (inclusive). "
                    + "Reports show refunds separately from revenue.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Refund totals")
    public ResponseEntity<ApiResponse<RefundSummaryResponse>> summary(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First business-zone day (inclusive).") LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last business-zone day (inclusive).") LocalDate to,
            @RequestParam(required = false) @Parameter(description = "Machine UUID filter.") UUID machineId) {
        return ok("Refund summary retrieved", queries.summary(from, to, machineId));
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
