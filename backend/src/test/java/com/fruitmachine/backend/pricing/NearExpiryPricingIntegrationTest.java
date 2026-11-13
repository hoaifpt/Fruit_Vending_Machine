package com.fruitmachine.backend.pricing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.pricing.model.DiscountSetting;
import com.fruitmachine.backend.pricing.service.NearExpiryPricingService;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.entity.ProductBatch;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import com.fruitmachine.backend.support.TestDataFactory;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Issue #61 §10–§14: the discount setting API, the kiosk catalog, order creation, payment and admin views on real PostgreSQL. */
class NearExpiryPricingIntegrationTest extends AbstractWebhookIntegrationTest {
    static final String SETTING = "/api/v1/pricing/near-expiry-discount";
    @Autowired BusinessCalendar calendar;
    @Autowired NearExpiryPricingService pricing;

    @BeforeEach
    void defaultSetting() {
        jdbc.update("UPDATE pricing_settings SET near_expiry_enabled = TRUE, near_expiry_percent = 50, updated_by = NULL");
    }

    // ---- helpers ----

    /** Leaves at least 30 minutes before midnight (Vietnam) so "today" bowls outlive the 5-minute reservation hold. */
    Instant now() {
        Instant now = clock.instant();
        Instant midnight = calendar.dayEnd(calendar.today(now));
        if (Duration.between(now, midnight).compareTo(Duration.ofMinutes(30)) < 0) clock.advance(Duration.between(now, midnight).plusHours(1));
        return clock.instant();
    }

    /** Expires today in the business zone, after the reservation hold. */
    Instant today() {
        Instant now = now();
        return calendar.dayEnd(calendar.today(now)).minus(Duration.ofMinutes(10));
    }

    Instant tomorrow() {
        return calendar.dayEnd(calendar.today(now())).plus(Duration.ofHours(3));
    }

    UUID batch(UUID product, int quantity, Instant expiresAt) throws Exception {
        return TestDataFactory.id(fixtures.api("POST", "/api/v1/product-batches", Map.of("batchCode", "PRICE-" + UUID.randomUUID(), "productId", product,
                "manufacturedAt", Instant.now().minus(Duration.ofHours(2)).truncatedTo(ChronoUnit.SECONDS).toString(),
                "expiresAt", expiresAt.truncatedTo(ChronoUnit.SECONDS).toString(), "quantity", quantity), staff.token(), 201));
    }

    record Kiosk(UUID machine, String key) { }

    Kiosk kiosk() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        return new Kiosk(machine, issueKey(machine));
    }

    JsonNode catalogEntry(Kiosk kiosk, UUID product) throws Exception {
        for (JsonNode entry : kioskData("GET", "/api/v1/kiosk/catalog", kiosk.key(), null, 200).path("products"))
            if (entry.path("productId").asText().equals(product.toString())) return entry;
        throw new AssertionError("product not in catalog");
    }

    JsonNode order(Kiosk kiosk, UUID product) throws Exception {
        return kioskData("POST", "/api/v1/kiosk/orders", kiosk.key(), orderBody(product), 201);
    }

    JsonNode setting() throws Exception {
        return fixtures.api("GET", SETTING, null, admin.token(), 200);
    }

    JsonNode put(boolean enabled, Object percent, long version, int expected) throws Exception {
        var body = new HashMap<String, Object>();
        body.put("enabled", enabled);
        body.put("percent", percent);
        body.put("version", version);
        return fixtures.api("PUT", SETTING, body, admin.token(), expected);
    }

    JsonNode change(boolean enabled, int percent) throws Exception {
        return put(enabled, percent, setting().path("version").asLong(), 200);
    }

    long audits() {
        return jdbc.queryForObject("SELECT count(*) FROM audit_logs WHERE action = 'PRICING_NEAR_EXPIRY_UPDATED'", Long.class);
    }

    // ---- 10. setting API ----

    @Test
    void adminChangesTheSettingStaffReadsItAndEveryChangeIsAudited() throws Exception {
        var current = setting();
        assertThat(current.fieldNames()).toIterable().containsExactlyInAnyOrder("enabled", "percent", "version", "updatedAt", "updatedBy", "businessZone");
        assertThat(current.path("enabled").asBoolean()).isTrue();
        assertThat(current.path("percent").asInt()).isEqualTo(50);
        assertThat(current.path("businessZone").asText()).isEqualTo("Asia/Ho_Chi_Minh");
        long version = current.path("version").asLong();
        assertThat(fixtures.api("GET", SETTING, null, staff.token(), 200).path("percent").asInt()).isEqualTo(50);

        long before = audits();
        var changed = put(true, 30, version, 200);
        assertThat(changed.path("percent").asInt()).isEqualTo(30);
        assertThat(changed.path("version").asLong()).isEqualTo(version + 1);
        assertThat(changed.path("updatedBy").path("id").asText()).isEqualTo(admin.id().toString());
        assertThat(changed.path("updatedBy").path("fullName").asText()).isNotBlank();
        assertThat(audits()).isEqualTo(before + 1);
        var row = jdbc.queryForMap("""
                SELECT a.user_id, a.entity_type, a.entity_id, a.old_value::text AS old_value, a.new_value::text AS new_value, a.ip_address
                FROM audit_logs a WHERE a.action = 'PRICING_NEAR_EXPIRY_UPDATED' ORDER BY a.created_at DESC, a.id DESC LIMIT 1""");
        assertThat(row.get("user_id")).isEqualTo(admin.id());
        assertThat(row.get("entity_type")).isEqualTo("PRICING_SETTINGS");
        assertThat(row.get("entity_id")).isEqualTo(jdbc.queryForObject("SELECT id FROM pricing_settings", UUID.class));
        assertThat(json.readTree((String) row.get("old_value"))).isEqualTo(json.readTree("{\"enabled\":true,\"percent\":50}"));
        assertThat(json.readTree((String) row.get("new_value"))).isEqualTo(json.readTree("{\"enabled\":true,\"percent\":30}"));
        assertThat(row.get("ip_address")).isNotNull();

        // Same values: 200, version unchanged, no audit row.
        var same = put(true, 30, version + 1, 200);
        assertThat(same.path("version").asLong()).isEqualTo(version + 1);
        assertThat(audits()).isEqualTo(before + 1);
        // Stale version: someone else changed it.
        fixtures.response("PUT", SETTING, Map.of("enabled", false, "percent", 30, "version", version), admin.token(), 409);
        assertThat(setting().path("enabled").asBoolean()).isTrue();

        for (Object bad : List.of(0, 91, 50.5, "50", -1)) put(true, bad, version + 1, 400);
        fixtures.response("PUT", SETTING, Map.of("percent", 50, "version", version + 1), admin.token(), 400);
        fixtures.response("PUT", SETTING, Map.of("enabled", true, "percent", 50), admin.token(), 400);
        fixtures.response("PUT", SETTING, Map.of("enabled", true, "percent", 50, "version", version + 1, "extra", 1), admin.token(), 400);
        assertThat(audits()).isEqualTo(before + 1);

        fixtures.response("PUT", SETTING, Map.of("enabled", true, "percent", 40, "version", version + 1), staff.token(), 403);
        fixtures.response("GET", SETTING, null, null, 401);
        var kiosk = kiosk();
        assertThat(kioskCall("GET", SETTING, kiosk.key(), null).getResponse().getStatus()).isEqualTo(401);
        assertThat(kioskCall("PUT", SETTING, kiosk.key(), Map.of("enabled", true, "percent", 40, "version", version + 1)).getResponse().getStatus()).isEqualTo(401);
    }

    // ---- 12. catalog, 13. order creation, 10. "effective immediately" ----

    @Test
    void aBowlExpiringTodayIsSoldAtTheDiscountLockedAtReservation() throws Exception {
        var kiosk = kiosk();
        UUID product = createProduct("Discount mango", "35000");
        UUID a = createSlot(kiosk.machine(), "A", 10), b = createSlot(kiosk.machine(), "B", 10);
        load(batch(product, 1, today()), a, 1);
        load(batch(product, 1, today().plusSeconds(60)), b, 1);

        var entry = catalogEntry(kiosk, product);
        assertThat(entry.path("price").decimalValue()).isEqualByComparingTo("17500");
        assertThat(entry.path("originalPrice").decimalValue()).isEqualByComparingTo("35000");
        assertThat(entry.path("discountPercent").asInt()).isEqualTo(50);
        assertThat(entry.path("discountReason").asText()).isEqualTo("NEAR_EXPIRY");
        assertThat(entry.path("availableQuantity").asLong()).isEqualTo(2);

        var first = order(kiosk, product);
        assertThat(first.path("subtotal").decimalValue()).isEqualByComparingTo("35000");
        assertThat(first.path("discountAmount").decimalValue()).isEqualByComparingTo("17500");
        assertThat(first.path("totalAmount").decimalValue()).isEqualByComparingTo("17500");
        var line = first.path("items").get(0);
        assertThat(line.path("originalUnitPrice").decimalValue()).isEqualByComparingTo("35000");
        assertThat(line.path("unitPrice").decimalValue()).isEqualByComparingTo("17500");
        assertThat(line.path("totalPrice").decimalValue()).isEqualByComparingTo("17500");
        assertThat(line.path("discountPercent").asInt()).isEqualTo(50);
        assertThat(line.path("discountReason").asText()).isEqualTo("NEAR_EXPIRY");
        UUID firstId = UUID.fromString(first.path("id").asText());
        assertThat(jdbc.queryForMap("SELECT original_unit_price, unit_price, discount_percent, discount_reason FROM order_items WHERE order_id = ?", firstId))
                .containsEntry("discount_reason", "NEAR_EXPIRY").containsEntry("discount_percent", 50);

        // A change applies at once to the catalog and the next order; the first order keeps its price.
        change(true, 30);
        assertThat(catalogEntry(kiosk, product).path("price").decimalValue()).isEqualByComparingTo("24500");
        var second = order(kiosk, product);
        assertThat(second.path("totalAmount").decimalValue()).isEqualByComparingTo("24500");
        assertThat(second.path("items").get(0).path("discountPercent").asInt()).isEqualTo(30);
        assertThat(orderTotal(firstId)).isEqualTo("17500.00");

        // Payment charges the locked amount (whole VND), whatever the setting is now.
        change(false, 30);
        var placed = new PlacedOrder(new Shop(kiosk.machine(), a, product, kiosk.key()), firstId, first.path("orderCode").asText());
        var payment = pay(placed, 201).path("data");
        assertThat(payment.path("amount").decimalValue()).isEqualByComparingTo("17500");
        assertThat(paid(referenceOf(firstId), "TXN-" + firstId, orderTotal(firstId))).isEqualTo(200);
        assertThat(orderStatus(firstId)).isIn("PAID", "DISPENSING");

        // Admin views: original price, discount and paid amount.
        var detail = fixtures.api("GET", "/api/v1/orders/" + firstId, null, staff.token(), 200);
        assertThat(detail.path("subtotal").decimalValue()).isEqualByComparingTo("35000");
        assertThat(detail.path("discountAmount").decimalValue()).isEqualByComparingTo("17500");
        assertThat(detail.path("totalAmount").decimalValue()).isEqualByComparingTo("17500");
        assertThat(detail.path("items").get(0).path("originalUnitPrice").decimalValue()).isEqualByComparingTo("35000");
        assertThat(detail.path("items").get(0).path("discountReason").asText()).isEqualTo("NEAR_EXPIRY");
    }

    @Test
    void theNextBowlDecidesThePriceAndTheRuleMatchesTheCatalogQuery() throws Exception {
        // Two heads: A expires today, B tomorrow. FEFO picks A: discounted.
        var fefo = kiosk();
        UUID product = createProduct("FEFO kiwi", "35000");
        load(batch(product, 1, tomorrow()), createSlot(fefo.machine(), "B", 10), 1);
        load(batch(product, 1, today()), createSlot(fefo.machine(), "A", 10), 1);
        assertThat(catalogEntry(fefo, product).path("discountPercent").asInt()).isEqualTo(50);

        // A discounted bowl behind a full-price head in the same column is not the next bowl.
        var behind = kiosk();
        UUID slot = createSlot(behind.machine(), "A", 10);
        load(batch(product, 1, tomorrow()), slot, 1);
        load(batch(product, 1, today()), slot, 1);
        var entry = catalogEntry(behind, product);
        assertThat(entry.path("price").decimalValue()).isEqualByComparingTo("35000");
        assertThat(entry.path("discountPercent").asInt()).isZero();
        assertThat(entry.path("discountReason").asText()).isEqualTo("NONE");
        var order = order(behind, product);
        assertThat(order.path("totalAmount").decimalValue()).isEqualByComparingTo("35000");
        assertThat(order.path("discountAmount").decimalValue()).isEqualByComparingTo("0");
        assertThat(order.path("items").get(0).path("discountReason").asText()).isEqualTo("NONE");

        // Disabled: every price is the original.
        change(false, 50);
        var off = catalogEntry(fefo, product);
        assertThat(off.path("price").decimalValue()).isEqualByComparingTo("35000");
        assertThat(off.path("discountReason").asText()).isEqualTo("NONE");

        // SQL and Java agree for awkward prices and every edge percent.
        List<String> prices = List.of("35000", "25001", "12345.67", "1");
        List<UUID> products = new java.util.ArrayList<>();
        List<Kiosk> kiosks = List.of(kiosk(), kiosk());
        for (int i = 0; i < prices.size(); i++) {
            UUID p = createProduct("Rule " + i, prices.get(i));
            products.add(p);
            load(batch(p, 1, today()), createSlot(kiosks.get(i / 2).machine(), i % 2 == 0 ? "A" : "B", 10), 1);
        }
        for (int percent : List.of(1, 30, 50, 89, 90)) {
            change(true, percent);
            for (int i = 0; i < prices.size(); i++) {
                var product1 = new Product();
                product1.setPrice(new BigDecimal(prices.get(i)));
                var batch = new ProductBatch();
                batch.setExpiresAt(today());
                var expected = pricing.priceFor(product1, batch, clock.instant(), new DiscountSetting(true, percent));
                var catalog = catalogEntry(kiosks.get(i / 2), products.get(i));
                assertThat(catalog.path("price").decimalValue()).as("%s at %d%%", prices.get(i), percent).isEqualByComparingTo(expected.unitPrice());
                assertThat(catalog.path("discountPercent").asInt()).isEqualTo(expected.discountPercent());
            }
        }
    }

    // ---- 14. admin visibility ----

    @Test
    void adminsFilterDiscountedOrdersAndSeeWhichBowlsAreEligibleToday() throws Exception {
        var kiosk = kiosk();
        UUID product = createProduct("Visible pear", "40000");
        UUID a = createSlot(kiosk.machine(), "A", 10), b = createSlot(kiosk.machine(), "B", 10);
        load(batch(product, 2, today()), a, 2);
        load(batch(product, 1, tomorrow()), b, 1);

        var items = fixtures.api("GET", "/api/v1/machines/" + kiosk.machine() + "/inventory?size=50", null, staff.token(), 200).path("content");
        assertThat(items).hasSize(3);
        for (JsonNode item : items) {
            boolean today = item.path("slotId").asText().equals(a.toString());
            assertThat(item.path("discountEligibleToday").asBoolean()).as(item.toString()).isEqualTo(today);
        }

        UUID discounted = UUID.fromString(order(kiosk, product).path("id").asText());
        // Column A's head is now reserved; B's head (tomorrow) sells at full price.
        UUID full = UUID.fromString(order(kiosk, product).path("id").asText());
        String base = "/api/v1/orders?machineId=" + kiosk.machine();
        assertThat(fixtures.api("GET", base + "&discounted=true", null, staff.token(), 200).path("content").findValuesAsText("id"))
                .containsExactly(discounted.toString());
        assertThat(fixtures.api("GET", base + "&discounted=false", null, staff.token(), 200).path("content").findValuesAsText("id"))
                .containsExactly(full.toString());
        var all = fixtures.api("GET", base, null, staff.token(), 200).path("content");
        assertThat(all.findValuesAsText("discountAmount")).hasSize(2);
        fixtures.response("GET", base + "&discounted=maybe", null, staff.token(), 400);

        change(false, 50);
        for (JsonNode item : fixtures.api("GET", "/api/v1/machines/" + kiosk.machine() + "/inventory?size=50", null, staff.token(), 200).path("content"))
            assertThat(item.path("discountEligibleToday").asBoolean()).isFalse();
    }

    @Test
    void anOrderKeepsItsDiscountAfterMidnight() throws Exception {
        var kiosk = kiosk();
        UUID product = createProduct("Midnight melon", "35000");
        load(batch(product, 1, today()), createSlot(kiosk.machine(), "A", 10), 1);
        var created = order(kiosk, product);
        UUID id = UUID.fromString(created.path("id").asText());
        assertThat(created.path("totalAmount").decimalValue()).isEqualByComparingTo("17500");
        // Keep the reservation open across midnight, then move past it: nothing is recalculated.
        jdbc.update("UPDATE orders SET expires_at = expires_at + interval '2 days' WHERE id = ?", id);
        Instant now = clock.instant();
        clock.advance(Duration.between(now, calendar.dayEnd(calendar.today(now))).plusMinutes(5));
        var placed = new PlacedOrder(new Shop(kiosk.machine(), null, product, kiosk.key()), id, created.path("orderCode").asText());
        assertThat(pay(placed, 201).path("data").path("amount").decimalValue()).isEqualByComparingTo("17500");
        var after = kioskData("GET", "/api/v1/kiosk/orders/" + id, kiosk.key(), null, 200);
        assertThat(after.path("totalAmount").decimalValue()).isEqualByComparingTo("17500");
        assertThat(after.path("discountAmount").decimalValue()).isEqualByComparingTo("17500");
    }

    // ---- 11. migration constraints ----

    @Test
    void theSchemaGuardsTheSettingAndThePriceSnapshots() throws Exception {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pricing_settings", Long.class)).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO pricing_settings (id, near_expiry_enabled, near_expiry_percent) VALUES (gen_random_uuid(), TRUE, 40)"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO pricing_settings (id, near_expiry_enabled, near_expiry_percent, singleton) VALUES (gen_random_uuid(), TRUE, 40, FALSE)"))
                .isInstanceOf(DataIntegrityViolationException.class);
        for (int percent : List.of(0, 91))
            assertThatThrownBy(() -> jdbc.update("UPDATE pricing_settings SET near_expiry_percent = ?", percent)).isInstanceOf(DataIntegrityViolationException.class);

        var kiosk = kiosk();
        UUID product = createProduct("Schema plum", "35000");
        load(batch(product, 1, tomorrow()), createSlot(kiosk.machine(), "A", 10), 1);
        UUID order = UUID.fromString(order(kiosk, product).path("id").asText());
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET discount_amount = 100 WHERE id = ?", order)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET discount_amount = 40000, total_amount = -5000 WHERE id = ?", order)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE order_items SET original_unit_price = 1000 WHERE order_id = ?", order)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE order_items SET discount_percent = 10 WHERE order_id = ?", order)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE order_items SET discount_reason = 'COUPON' WHERE order_id = ?", order)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE order_items SET discount_reason = 'NEAR_EXPIRY' WHERE order_id = ?", order)).isInstanceOf(DataIntegrityViolationException.class);
    }
}
