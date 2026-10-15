package com.fruitmachine.backend.support;

import com.fruitmachine.backend.payment.gateway.PaymentGateway;
import com.fruitmachine.backend.payment.gateway.PaymentProviderException;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentRequest;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentResult;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.jdbc.core.JdbcTemplate;

/** Test provider (code TESTPAY) whose behavior and timing the test controls; it never touches a network. */
public final class ControllableGateway implements PaymentGateway {
    public static final String PROVIDER = "TESTPAY";

    public enum Mode { SUCCESS, FAIL, BLANK_QR, TIMEOUT }

    private final JdbcTemplate jdbc;
    private final AtomicInteger calls = new AtomicInteger();
    private final List<Long> idleInTransactionDuringCall = new CopyOnWriteArrayList<>();
    private final List<ProviderPaymentRequest> requests = new CopyOnWriteArrayList<>();
    private volatile Mode mode = Mode.SUCCESS;
    private volatile Runnable duringCall = () -> { };
    private volatile Instant providerExpiresAt;

    public ControllableGateway(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void reset() {
        mode = Mode.SUCCESS;
        duringCall = () -> { };
        providerExpiresAt = null;
        calls.set(0);
        idleInTransactionDuringCall.clear();
        requests.clear();
    }

    public void mode(Mode mode) { this.mode = mode; }
    public void duringCall(Runnable hook) { this.duringCall = hook; }
    public void providerExpiresAt(Instant instant) { this.providerExpiresAt = instant; }
    public int calls() { return calls.get(); }
    public List<Long> idleInTransactionDuringCall() { return idleInTransactionDuringCall; }
    public List<ProviderPaymentRequest> requests() { return requests; }

    @Override
    public String provider() {
        return PROVIDER;
    }

    @Override
    public String newPaymentReference() {
        return "TEST-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase();
    }

    @Override
    public ProviderPaymentResult createPayment(ProviderPaymentRequest request) {
        calls.incrementAndGet();
        requests.add(request);
        // Sessions of this database that sit idle inside a transaction would mean a transaction spans the provider call.
        idleInTransactionDuringCall.add(jdbc.queryForObject(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'", Long.class));
        duringCall.run();
        return switch (mode) {
            case FAIL -> throw new PaymentProviderException("test provider rejected the request");
            case TIMEOUT -> {
                try {
                    Thread.sleep(Duration.ofSeconds(30));
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    throw new PaymentProviderException("interrupted");
                }
                yield new ProviderPaymentResult("TEST-QR|late", null);
            }
            case BLANK_QR -> new ProviderPaymentResult("  ", null);
            case SUCCESS -> new ProviderPaymentResult("TEST-QR|" + request.paymentReference() + "|" + request.amount().toPlainString(), providerExpiresAt);
        };
    }
}
