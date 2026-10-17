package com.fruitmachine.backend.payment.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.payment.dto.PaymentWebhookLogDetailResponse;
import com.fruitmachine.backend.payment.dto.PaymentWebhookLogPageResponse;
import com.fruitmachine.backend.payment.service.PaymentWebhookLogService;
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
@Tag(name = "Payment Webhook Logs", description = "Read-only evidence of every provider webhook attempt for ADMIN. No replay, no delete, and the signature is never returned.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token (a kiosk key is not accepted here)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account is not ADMIN", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class PaymentWebhookLogController {
    private final PaymentWebhookLogService logs;

    @GetMapping("/api/v1/payment-webhook-logs")
    @Operation(operationId = "listPaymentWebhookLogs", summary = "List webhook attempts",
            description = "ADMIN only. Database pagination page0/size20/max100. Filters combine: provider (case-insensitive), verified, reference (exact match on the untrusted provider reference hint), receivedFrom (inclusive), receivedTo (exclusive). "
                    + "Sort receivedAt (default desc) or provider, each with a UUID tie-break. Items never include the body or signature.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Database page of webhook attempts")
    public ResponseEntity<ApiResponse<PaymentWebhookLogPageResponse>> list(
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size 1..100.") int size,
            @RequestParam(required = false) @Parameter(description = "Provider code, case-insensitive, for example PAYOS.") String provider,
            @RequestParam(required = false) @Parameter(description = "true for verified attempts only, false for rejected ones.") Boolean verified,
            @RequestParam(required = false) @Parameter(description = "Exact provider reference hint (for payOS the orderCode).") String reference,
            @RequestParam(required = false) @Parameter(description = "ISO-8601 instant, inclusive lower bound of receivedAt.") Instant receivedFrom,
            @RequestParam(required = false) @Parameter(description = "ISO-8601 instant, exclusive upper bound of receivedAt.") Instant receivedTo,
            @RequestParam(defaultValue = "receivedAt,desc") @Parameter(description = "receivedAt or provider with optional asc/desc.") String sort) {
        return ok("Webhook logs retrieved", logs.list(page, size, provider, verified, reference, receivedFrom, receivedTo, sort));
    }

    @GetMapping("/api/v1/payment-webhook-logs/{id}")
    @Operation(operationId = "getPaymentWebhookLog", summary = "Get a webhook attempt with its evidence",
            description = "ADMIN only. rawPayload is the parsed JSON body; rawBody carries the exact text only when the body was not valid JSON. The signature is never returned.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Webhook attempt details"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Webhook log not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<PaymentWebhookLogDetailResponse>> get(@PathVariable @Parameter(description = "Webhook log UUID.") UUID id) {
        return ok("Webhook log retrieved", logs.get(id));
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
