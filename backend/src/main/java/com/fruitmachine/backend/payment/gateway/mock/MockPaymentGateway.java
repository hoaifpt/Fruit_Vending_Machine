package com.fruitmachine.backend.payment.gateway.mock;

import com.fruitmachine.backend.payment.gateway.PaymentGateway;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentRequest;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentResult;
import java.security.SecureRandom;
import org.springframework.stereotype.Component;

/** Development/test provider: no network, never marks anything paid. Rejected as the active provider in prod. */
@Component
public class MockPaymentGateway implements PaymentGateway {
    public static final String PROVIDER = "MOCK";
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    @Override
    public String provider() {
        return PROVIDER;
    }

    @Override
    public String newPaymentReference() {
        var reference = new StringBuilder("MOCK-");
        for (int i = 0; i < 8; i++) reference.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return reference.toString();
    }

    @Override
    public ProviderPaymentResult createPayment(ProviderPaymentRequest request) {
        return new ProviderPaymentResult("MOCK-QR|" + request.paymentReference() + "|" + request.amount().toPlainString(), null);
    }
}
