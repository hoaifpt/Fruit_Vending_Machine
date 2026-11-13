# Issue #61 — [BE] Implement Near-Expiry Discount Pricing

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/61
Branch: feature/61-near-expiry-discount (from origin/dev edaeaca, includes #59 via PR #62)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
app.business-zone (BusinessProperties, BusinessCalendar), order codes in the business zone, V18 (pricing_settings singleton,
orders.discount_amount, order_items original_unit_price / discount_percent / discount_reason with CHECKs, PRICING_READ / PRICING_MANAGE),
pricing package (NearExpiryPricingService rule, PricingSettingsService get/update + audit, GET/PUT /api/v1/pricing/near-expiry-discount),
price snapshot at order creation, catalog price of the next FEFO bowl (same SQL query), order/inventory response fields, orders filter
discounted, docs/Swagger/api.yaml.

## Non-goals
Per-product/batch discounts, coupons, scheduled changes, repricing existing orders, frontend screens, payOS order code format.

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 779 tests, 0 failures,
BUILD SUCCESS. New: NearExpiryPricingRuleTest (7), NearExpiryPricingIntegrationTest (5), NearExpiryPricingMigrationTest (2),
NearExpiryPricingDocumentationTest (1). Updated: migration/table/entity counts, permission lists and matrix, order_items fixtures
(original_unit_price), KioskCatalogIntegrationTest field list, db/verify/constraints.sql.

Decisions / notes:
- No sales report API exists yet (F-09): report discount totals and report day grouping are not implemented; the two related
  checkboxes stay open. BusinessCalendar is ready for it.
- discountEligibleToday also requires the bowl not to be expired yet (an expired bowl cannot be sold).
- Settings are read per request (no cache); PUT locks the row and compares the client version (409 when stale); same values = no-op.
- Audit ip_address = request remote address (forward headers are applied by the server when configured).
- api.yaml: only the changed paths/schemas were re-emitted (pricing path, /orders, order/catalog/inventory schemas).

# Testing

## 8. Business Zone

- [x] Invalid `BUSINESS_ZONE` fails startup
- [x] Order created 13/11 01:00 VN (12/11 18:00 UTC) → code `ORD-20261113-…`
- [x] Order created 13/11 23:30 VN → `ORD-20261113-…`

## 9. Pricing Unit Tests (fixed Clock)

- [x] Batch expiring today (VN) → 50%, rounded down (35,000 → 17,500; 25,001 → 12,500)
- [x] Percent 30 → 24,500; percent 90 → 3,500
- [x] Batch expiring tomorrow 00:00:01 VN → no discount
- [x] Day boundary uses business zone, not UTC
- [x] Disabled → no discount

## 10. Discount Setting API

- [x] Admin GET/PUT works; STAFF GET only (PUT → 403); kiosk key / anonymous → 401
- [x] percent 0, 91, non-integer → 400
- [x] Stale version → 409
- [x] Change → one audit row with old/new values and actor; no-op → no audit row
- [x] Change visible in catalog and next order immediately; existing orders unchanged

## 11. Migration

- [x] Applies on DB with existing orders; backfill correct; singleton seeded once
- [x] Second settings row rejected; percent out of range rejected
- [x] Order CHECKs reject total ≠ subtotal − discount and unit > original
- [x] Flyway + Hibernate validation pass

## 12. Catalog (real PostgreSQL)

- [x] FEFO head expiring today → discounted price, originalPrice, badge fields
- [x] Two slots: head A expires today, head B tomorrow → catalog discounted (FEFO picks A)
- [x] Discounted bowl behind a non-discounted head in the same column → not discounted
- [x] Setting disabled → all original prices
- [x] No N+1; existing catalog tests pass

## 13. Order Creation

- [x] Eligible bowl → order total discounted, item fields set, CHECKs satisfied
- [x] Non-eligible bowl → original price, NONE
- [x] Order before midnight keeps discounted price after midnight
- [x] Setting changed after order creation → order and payment amount unchanged
- [x] Payment amount = order.total_amount (whole VND accepted by payOS gateway)

## 14. Admin Visibility

- [ ] `discounted` filter, inventory `discountEligibleToday`, report discount totals, report days in business zone

## 15. Regression

- [x] Order, payment, webhook, refund, dispense tests pass
- [x] Authorization matrix extended with pricing endpoints
- [x] All tests pass (`mvn clean verify`); Swagger / `api.yaml` consistent

# Acceptance Criteria

- [x] Admin can view and change near-expiry discount (on/off, 1–90%); STAFF can view; every change audited
- [x] Bowls whose batch expires today (business zone) are sold at the current percent, rounded down to whole VND
- [x] Price decided from the reserved bowl and locked at order creation; setting changes affect only new orders
- [x] Catalog shows the effective price of the next bowl plus original price and discount
- [x] Orders store original price, discount and amount paid; payment charges the discounted amount
- [ ] Order codes and report days use Asia/Ho_Chi_Minh
- [x] Migration with CHECKs; applied migrations unchanged
- [x] Docs, Swagger, `api.yaml`, ERD updated
- [x] Tests pass (`mvn clean verify`)
