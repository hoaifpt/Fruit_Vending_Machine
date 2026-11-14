# Issue #76 — [BE] Implement Dashboard & Reports API

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/76
Branch: feature/76-reports (from origin/dev d6e8d11, includes #74 via PR #75)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.
Downloads approved by the user (2026-11-14): Apache PDFBox 3.0.4 (Maven Central) and Noto Sans Regular/Bold + OFL.txt (notofonts GitHub).

## Scope
V25 (report indexes, DASHBOARD_READ / REPORT_SALES_READ / REPORT_EXPORT), report package (SalesReportQueries aggregate SQL, SalesReportService
with filter validation and zero-fill, CSV and PDF writers, ReportExportService with audit, SalesReportController), dashboard package
(DashboardService, DashboardController), HealthCheckQueries shared slot SQL, RefundQueryService.pendingTotals + IN-set predicates,
docs/reports.md, api.yaml, fonts under src/main/resources/fonts.

## Non-goals
Charts / UI, scheduled or emailed reports, waste / batch / inventory reports, cost and profit, Excel export, caching / materialized views.

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 Testcontainers): 870 tests, 0 failures, BUILD SUCCESS.
New: SalesReportIntegrationTest (10), DashboardIntegrationTest (3), SalesReportPerformanceTest (1), ReportDocumentationTest (1).
Updated: V25 counts, permissions 41, STAFF lists (+DASHBOARD_READ), matrix, path lists, served operations 109.

Performance (100k orders, best of 3, whole request): summary 184 ms, summary with filters 302 ms, series 78-88 ms, peak 116 ms,
products 93 ms, machines 30 ms, refund candidates 417 ms, export CSV 567 ms, PDF 1250 ms (target/report-performance.txt).

Decisions / notes:
- failedDispenses = paid in range and (DISPENSE_FAILED, or REFUNDED never completed nor cancelled, or a FAILED/TIMEOUT dispense command).
- pendingRefunds ignores range and filters (point in time).
- Product ties sort by name in the database collation, then id.
- blockedSlots = slot ERROR or head bowl DISPENSE_FAILED; bowlsExpiringToday uses the health-check expiring predicate up to the end of the day.
- Refund candidate SQL rewritten with uncorrelated IN sets (same results) to meet the targets; also speeds up GET /refunds/candidates.
