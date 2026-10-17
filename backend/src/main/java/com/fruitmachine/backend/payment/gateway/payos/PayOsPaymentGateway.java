package com.fruitmachine.backend.payment.gateway.payos;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.config.properties.PaymentProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.payment.gateway.PaymentGateway;
import com.fruitmachine.backend.payment.gateway.PaymentProviderException;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentRequest;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentResult;
import com.fruitmachine.backend.payment.gateway.VerifiedPaymentEvent;
import com.fruitmachine.backend.payment.gateway.WebhookVerificationResult;
import com.fruitmachine.backend.payment.gateway.payos.dto.PayOsCreateRequest;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;

/**
 * payOS VietQR adapter. The bean is always present but inert: nothing is validated or called unless it is the active
 * provider, so MOCK development and tests never need payOS secrets.
 */
@Slf4j
@Component
@EnableConfigurationProperties(PayOsProperties.class)
public class PayOsPaymentGateway implements PaymentGateway {
    public static final String PROVIDER = "PAYOS";
    /** Conservative integer bound for one charge (Int32 max VND, about 2.1 billion). */
    static final long MAX_AMOUNT = Integer.MAX_VALUE;
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyMMddHHmmss").withZone(ZoneOffset.UTC);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final PayOsProperties properties;
    private final Clock clock;
    private final PayOsClient client;
    private final PayOsWebhookVerifier verifier;
    private final PayOsWebhookParser parser;

    @Autowired
    public PayOsPaymentGateway(PayOsProperties properties, PaymentProperties payment, Clock clock, ObjectMapper mapper,
            PayOsWebhookVerifier verifier, PayOsWebhookParser parser) {
        this.properties = properties;
        this.clock = clock;
        this.client = new PayOsClient(properties, payment.providerTimeout(), mapper);
        this.verifier = verifier;
        this.parser = parser;
    }

    /** Convenience for tests: verifier and parser built from the same properties. */
    public PayOsPaymentGateway(PayOsProperties properties, PaymentProperties payment, Clock clock, ObjectMapper mapper) {
        this(properties, payment, clock, mapper, new PayOsWebhookVerifier(properties), new PayOsWebhookParser());
    }

    @Override
    public String provider() {
        return PROVIDER;
    }

    @Override
    public void validateConfiguration() {
        var problems = properties.problems();
        if (!problems.isEmpty()) {
            throw new IllegalStateException("app.payment.provider=PAYOS requires valid payOS configuration; missing or invalid: " + String.join(", ", problems));
        }
    }

    /** payOS orderCode: yyMMddHHmmss (UTC) plus 3 random digits, 15 digits, positive and below 2^53. */
    @Override
    public String newPaymentReference() {
        return STAMP.format(clock.instant()) + String.format(Locale.ROOT, "%03d", RANDOM.nextInt(1000));
    }

    /** payOS charges integer VND only: positive, no fractional part (35000.00 is fine, 35000.50 is not) and within the bound. */
    @Override
    public boolean supportsAmount(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) return false;
        BigDecimal stripped = amount.stripTrailingZeros();
        return stripped.scale() <= 0 && amount.compareTo(BigDecimal.valueOf(MAX_AMOUNT)) <= 0;
    }

    @Override
    public ProviderPaymentResult createPayment(ProviderPaymentRequest request) {
        if (!supportsAmount(request.amount())) throw new PaymentProviderException("Amount cannot be charged through payOS");
        long orderCode = parseOrderCode(request.paymentReference());
        long amount = request.amount().setScale(0, RoundingMode.UNNECESSARY).longValueExact();
        String description = description(request.orderCode());
        Long expiredAt = request.expiresAt() == null ? null : request.expiresAt().getEpochSecond();
        if (expiredAt != null && (expiredAt <= 0 || expiredAt > Integer.MAX_VALUE)) throw new PaymentProviderException("Attempt deadline is outside the range payOS accepts");
        String signature = PayOsSignature.createSignature(properties.checksumKey(), amount, properties.cancelUrl(), description, orderCode, properties.returnUrl());
        String qrCode = client.createLink(new PayOsCreateRequest(orderCode, amount, description, properties.returnUrl(), properties.cancelUrl(), expiredAt, signature));
        return new ProviderPaymentResult(qrCode, request.expiresAt());
    }

    @Override
    public void cancelPayment(String paymentReference, String reason) {
        try {
            client.cancel(parseOrderCode(paymentReference), reason);
        } catch (RuntimeException ex) {
            // Best effort: the backend EXPIRED state is authoritative. Only the orderCode is logged.
            log.warn("payOS link cancellation failed for orderCode {}: {}", paymentReference, ex.getClass().getSimpleName());
        }
    }

    /**
     * Delegates to the payOS verifier and parser. A body that is not authentic or cannot be parsed is rejected; an authentic
     * body yields SUCCESS (code 00 at both levels) or FAILED. The orderCode hint is read leniently from the untrusted body for the log only.
     */
    @Override
    public WebhookVerificationResult verifyWebhook(String rawBody, HttpHeaders headers) {
        String hint = null;
        String signature = null;
        try {
            JsonNode root = rawBody == null ? null : PayOsWebhookVerifier.RAW.readTree(rawBody);
            if (root != null && root.isObject()) {
                JsonNode order = root.path("data").path("orderCode");
                hint = order.isIntegralNumber() ? order.bigIntegerValue().toString() : order.isTextual() ? order.asText() : null;
                signature = root.path("signature").isTextual() ? root.path("signature").asText() : null;
            }
        } catch (Exception ex) {
            // Unparsable bodies are simply unverified; nothing about them is trusted.
        }
        if (!verifier.verify(rawBody)) return WebhookVerificationResult.rejected(hint, signature);
        PayOsWebhookEvent parsed;
        try {
            parsed = parser.parse(rawBody);
        } catch (PayOsWebhookException ex) {
            return WebhookVerificationResult.rejected(hint, signature);
        }
        VerifiedPaymentEvent.Type type = parsed.success() ? VerifiedPaymentEvent.Type.SUCCESS : VerifiedPaymentEvent.Type.FAILED;
        String eventType = parsed.success() ? "PAYMENT_SUCCESS" : "PAYMENT_FAILED";
        boolean actionable = !parsed.success() || (parsed.transactionId() != null && !parsed.transactionId().isBlank());
        return new WebhookVerificationResult(true, eventType, parsed.paymentReference(), signature,
                actionable ? new VerifiedPaymentEvent(type, parsed.paymentReference(), parsed.transactionId(), parsed.amount()) : null);
    }

    /** prefix + leading part of the order code random suffix, ASCII letters/digits only, never customer data. */
    String description(String orderCode) {
        String suffix = orderCode == null ? "" : orderCode.substring(orderCode.lastIndexOf('-') + 1);
        String clean = suffix.replaceAll("[^A-Za-z0-9]", "").toUpperCase(Locale.ROOT);
        int room = Math.max(0, properties.descriptionMaxLength() - properties.descriptionPrefix().length());
        return properties.descriptionPrefix() + clean.substring(0, Math.min(room, clean.length()));
    }

    private static long parseOrderCode(String reference) {
        try {
            long value = Long.parseLong(reference);
            if (value <= 0 || value > 9007199254740991L) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException | NullPointerException ex) {
            throw new PaymentProviderException("Payment reference is not a valid payOS orderCode");
        }
    }
}
