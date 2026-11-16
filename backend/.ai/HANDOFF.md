# Chat handoff - Issue #74, 2026-11-14

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/74, [BE] Implement Customer Incident Reporting.
Branch feature/74-customer-reports from origin/dev f582fc3 (includes #72).
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: V24 (machines.report_token, customer_reports, customer_report_photos, CUSTOMER_REPORT_READ / CUSTOMER_REPORT_MANAGE /
MACHINE_REPORT_LINK_MANAGE), customerreport package (PublicReportService, ReportOrderVerifier, ReportPhotoSanitizer, ReportSupport,
CustomerReportAdminService, MachineReportLinkService, CustomerReportLinks, rate limiting: SlidingWindowRateLimiter, ClientIpResolver,
PublicReportRateLimitInterceptor; controllers PublicReportController, CustomerReportController, KioskReportLinkController), refund
candidates CUSTOMER_REPORT + PaymentRefundedEvent auto-close, WorkOrderService.recordSystemNote + linkedReports, SecurityConfig public
rules / CORS, JwtAuthenticationFilter skip for /api/v1/public/**, 429 handler, multipart 7 MB.
Docs: docs/customer-reports.md, api.yaml, database-migration.md (ERD +2 tables), permission-authorization.md, refunds.md, work-orders.md,
.ai/DATABASE.md §27, README, .env.example (PUBLIC_REPORT_*, REPORT_*).

Verification: `mvn clean verify` 855 tests, 0 failures, BUILD SUCCESS.
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, use `mvn` (no wrapper), always `mvn clean ...`.
Deploy note: set REPORT_IP_HASH_SECRET, PUBLIC_REPORT_BASE_URL, PUBLIC_REPORT_ALLOWED_ORIGINS and REPORT_TRUSTED_PROXIES on staging.
Frontend owner still needs to be told: public form page /report/{token} (?order=) and the kiosk QR screens.
