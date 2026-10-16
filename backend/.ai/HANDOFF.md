# Chat handoff - Issue #31, 2026-10-15

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/31, [BE] Integrate QR Payment Provider (payOS).
Branch feature/31-payos-qr-provider from origin/dev 818ba49 (includes #29 via PR#30).
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: PayOsPaymentGateway (create link, best-effort cancel) behind PaymentGateway (new supportsAmount, cancelPayment, validateConfiguration),
PayOsProperties (secrets masked, validated only when PAYOS is active), PayOsClient (RestClient, no body logging), PayOsSignature, PayOsWebhookVerifier/Parser (components only),
integer-VND rule (409 before any attempt), 15-digit orderCode as payment_reference, after-commit cancel of expired attempts (PaymentExpiredEvent + PaymentCancellations),
docs/payment-provider.md, .ai docs, Swagger/api-contract text. No schema change, no endpoint, no dependency, no webhook endpoint, no SUCCESS/PAID.

Verification: clean verify 566 tests, 0 failures (JDK 21.0.10, PostgreSQL 18 Testcontainers). Checklist: all items checked except section 21 (4 manual payOS items).
Open: real payOS manual verification and confirming webhook canonicalization against a real webhook (needs merchant account + public HTTPS URL).
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
