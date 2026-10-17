package com.fruitmachine.backend.payment.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.payment.service.PaymentWebhookService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public provider endpoint: reaching it proves nothing. Only the provider signature verified by the active gateway makes
 * a request trustworthy. The body is read as the exact raw UTF-8 text and never bound to a DTO.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@Tag(name = "Payment Webhooks", description = "Provider-to-server payment notifications. Public endpoint authenticated only by the provider signature; "
        + "no JWT and no kiosk key. This is the only path that can produce payment SUCCESS and order PAID.")
public class PaymentWebhookController {
    static final int MAX_BODY_BYTES = 64 * 1024;
    private final PaymentWebhookService webhooks;

    @PostMapping(value = "/api/v1/webhooks/payments/{provider}", consumes = "application/json")
    @SecurityRequirements
    @Operation(operationId = "receivePaymentWebhook", summary = "Receive a payment provider webhook",
            description = "Public; trusted only after the provider signature is verified (payOS: the signature field of the body; MOCK, development only: X-Mock-Signature = hex HMAC-SHA256 of the exact raw body). "
                    + "The path provider must be the active provider (payos or mock, case-insensitive). The body must be JSON and at most 64 KB. Every attempt that reaches verification is stored in payment_webhook_logs. "
                    + "A verified event is processed idempotently under the Order then Payment locks: SUCCESS makes the payment SUCCESS and a PENDING_PAYMENT order PAID. Late, duplicate, amount-mismatched and conflicting payments are recorded for ADMIN review and never auto-resolved. "
                    + "Response policy: 200 for verified requests (processed, duplicate, unknown reference or anomaly, since retries cannot fix them); 401 when verification fails or the body is malformed; 404 unknown provider; 413 body too large; 415 not JSON; 500 on unexpected errors so the provider retries.")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(description = "Provider JSON payload exactly as sent; documentation examples use fake values and signatures shown as hex placeholders.",
            content = @Content(mediaType = "application/json", schema = @Schema(type = "object", additionalProperties = Schema.AdditionalPropertiesValue.TRUE)))
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Verified webhook acknowledged (minimal provider specific body)", content = @Content(schema = @Schema(type = "object", additionalProperties = Schema.AdditionalPropertiesValue.TRUE))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Signature missing or invalid, or the body is malformed", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Provider is not the active payment provider", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "413", description = "Body larger than 64 KB", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "415", description = "Content type is not application/json", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected error; the provider should retry", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<Object> receive(@PathVariable @Parameter(description = "Provider code, case-insensitive.", example = "payos") String provider,
            @RequestHeader HttpHeaders headers, HttpServletRequest request) throws IOException {
        var gateway = webhooks.requireActive(provider);
        if (request.getContentLengthLong() > MAX_BODY_BYTES) return tooLarge(request);
        // Read at most one byte more than the limit, so an oversized or endless body is never buffered.
        byte[] bytes = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (bytes.length > MAX_BODY_BYTES) return tooLarge(request);
        var result = webhooks.handle(gateway, new String(bytes, StandardCharsets.UTF_8), headers);
        if (!result.accepted()) {
            return error(HttpStatus.UNAUTHORIZED, "Unauthorized", "Webhook could not be verified", request);
        }
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(result.acknowledgement());
    }

    private static ResponseEntity<Object> tooLarge(HttpServletRequest request) {
        return error(HttpStatus.PAYLOAD_TOO_LARGE, "Payload Too Large", "Webhook body is too large", request);
    }

    private static ResponseEntity<Object> error(HttpStatus status, String reason, String message, HttpServletRequest request) {
        return ResponseEntity.status(status).header("Cache-Control", "no-store")
                .body(new ApiErrorResponse(Instant.now(), status.value(), reason, message, request.getRequestURI(), Map.of()));
    }
}
