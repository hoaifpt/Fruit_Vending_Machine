# Issue #74 — [BE] Implement Customer Incident Reporting

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/74
Branch: feature/74-customer-reports (from origin/dev f582fc3, includes #72 via PR #73)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V24 (machines.report_token, customer_reports, customer_report_photos, 3 permissions), customerreport package (public form + submit with
validation, honeypot, photo sanitizer, order verifier, work order create/join, in-memory rate limits via interceptor, client IP resolver,
admin list/detail/photo/review/resolve/reject, token rotation, kiosk report link), refund candidates CUSTOMER_REPORT + auto-close on refund
(PaymentRefundedEvent), work order linkedReports, /api/v1/public/** permitAll + CORS + JWT filter skip, 429 handler, multipart 7 MB,
docs / api.yaml / .env.example.

## Non-goals
Form UI and kiosk QR screen (frontend), customer accounts / status page / replies, bank account collection, CAPTCHA, distributed rate
limits, object storage, retention job, automatic refunds.

## Status and verification
Done locally, not committed. See HANDOFF.md for the `mvn clean verify` result.
New: CustomerReportIntegrationTest (22), CustomerReportDocumentationTest (1). Updated: V24 counts (tables 33, entities 32), permissions 38,
STAFF lists (+CUSTOMER_REPORT_READ), matrix (public and kiosk sets), path lists, served operations 102, refund query bound (+1 fixed query).

Decisions / notes:
- report_token default is 32 hex from gen_random_uuid (pgcrypto not installed); rotation writes 22-char base64url via a JPQL update.
- REPORT_IP_HASH_SECRET blank -> random per-start secret with a WARN; staging/production must set it.
- PUBLIC_REPORT_BASE_URL blank -> 409 REPORT_LINK_NOT_CONFIGURED on kiosk link / rotation.
- Order lookback: created on or after the start of the business day 7 days ago.
- Duplicate report of the same order joins the work order with a system NOTE; status IN_REVIEW; no new notification.
- Visibility: without CUSTOMER_REPORT_MANAGE only reports whose work order is assigned to the caller.
- The rate-limit interceptor is created by PublicReportWebConfig (not a bean) so @WebMvcTest slices still start.
