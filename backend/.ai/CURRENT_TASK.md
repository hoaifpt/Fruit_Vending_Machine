# Issue #72 — [BE] Implement Refund Management

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/72
Branch: feature/72-refunds (from origin/dev 1753feb, includes #70 via PR #71)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V23 (payments refund columns + CHECKs + unique transfer ref + refunded_at index, orders.refunded_at + CHECK, PAYMENT_REFUND / REFUND_READ),
payment.refund package (RefundService, RefundQueryService, PayerAccountResolver, RefundController, DTOs), PaymentTransitions.refund,
OrderTransitions.refund, refund block in payment detail, refundedAt + refunds[] in order detail (REFUND_READ only), Swagger tag Refunds,
api.yaml, docs/refunds.md and related docs.

## Non-goals
payOS / bank refund API, partial / cash / store-credit refunds, two-person approval, customer refund page, CUSTOMER_REPORT candidates (5.2).

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto Testcontainers): 832 tests, 0 failures, BUILD SUCCESS.
New: RefundIntegrationTest (17), RefundDocumentationTest (1). Updated: V23 counts, permission counts (35), matrix / path lists, served
operations (95); fixtures that wrote REFUNDED directly (DispenseFlowIntegrationTest, PaymentWebhookProcessingIntegrationTest) now set
the refund columns required by the V23 CHECKs.

Decisions / notes:
- Paying payment = earliest paid_at (then id) among SUCCESS / REFUNDED payments of the order.
- DUPLICATE_PAYMENT on the paying payment -> 409 REFUND_REASON_MISMATCH; any reason on PENDING_PAYMENT / PAID / DISPENSING order or with an
  unfinished dispense command -> 409 DISPENSE_IN_PROGRESS.
- workOrderId not found or not INCIDENT / CANCELLED -> 400.
- Order detail `refunds[]` (with transfer reference) only for REFUND_READ holders; STAFF gets an empty list.
- Candidates: waitingSince = paidAt; relatedWorkOrder always null for now; payer from verified webhook logs (order_code = payment_reference).
