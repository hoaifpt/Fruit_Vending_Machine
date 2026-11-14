package com.fruitmachine.backend.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * Issue #76 §7-§9, §11: metric definitions on a hand-built dataset (real PostgreSQL), series, peak hours, products, machines, exports
 * and access. Every query is filtered to this test's machines, so other data in the database never changes the expected numbers.
 *
 * <pre>
 * M1, product P "Dưa hấu" (35 000), product Q "=HYPERLINK("x")" (20 000, INACTIVE)
 * o1 P 35 000 - 5 000 discount, completed 31/10/2025 23:30 VN (16:30 UTC)
 * o2 P 35 000, completed 01/11 00:30 VN; a second (duplicate) payment paid 01/11 00:35 VN, refunded DUPLICATE_PAYMENT 01/11 10:00 VN
 * o3 Q 20 000, completed 02/11 10:00 VN, refunded PRODUCT_QUALITY 10/11 10:00 VN (order REFUNDED)
 * f1 P paid 03/11 10:00 VN, DISPENSE_FAILED, refunded 03/11 12:00 VN (order REFUNDED, never completed)
 * l1 P paid 04/11 10:00 VN after cancellation, refunded LATE_PAYMENT 04/11 11:00 VN (order CANCELLED)
 * M2: o4 P 35 000 completed 05/11 10:00 VN
 * </pre>
 */
class SalesReportIntegrationTest extends AbstractCoreIntegrationTest {
    static final String SUMMARY = "/api/v1/reports/sales/summary";
    UUID m1, m2, p, q;
    String base;

    @BeforeEach
    void dataset() throws Exception {
        m1 = fixtures.machine(admin.token());
        m2 = fixtures.machine(admin.token());
        p = product("Dưa hấu", 35000, "ACTIVE");
        q = product("=HYPERLINK(\"x\")", 20000, "INACTIVE");
        UUID o1 = sale(m1, p, 35000, 5000, at("2025-10-31T16:30:00Z"));
        UUID o2 = sale(m1, p, 35000, 0, at("2025-10-31T17:30:00Z"));
        UUID dup = payment(o2, 35000, at("2025-10-31T17:35:00Z"));
        refund(dup, "DUPLICATE_PAYMENT", at("2025-11-01T03:00:00Z"));
        UUID o3 = sale(m1, q, 20000, 0, at("2025-11-02T03:00:00Z"));
        refund(paymentOf(o3), "PRODUCT_QUALITY", at("2025-11-10T03:00:00Z"));
        jdbc.update("UPDATE orders SET status='REFUNDED', refunded_at=? WHERE id=?", ts("2025-11-10T03:00:00Z"), o3);
        UUID f1 = order(m1, p, 35000, 0, "DISPENSE_FAILED", at("2025-11-03T03:00:00Z"), null);
        refund(paymentOf(f1), "DISPENSE_FAILED", at("2025-11-03T05:00:00Z"));
        jdbc.update("UPDATE orders SET status='REFUNDED', refunded_at=? WHERE id=?", ts("2025-11-03T05:00:00Z"), f1);
        UUID l1 = order(m1, p, 35000, 0, "CANCELLED", at("2025-11-04T03:00:00Z"), null);
        refund(paymentOf(l1), "LATE_PAYMENT", at("2025-11-04T04:00:00Z"));
        sale(m2, p, 35000, 0, at("2025-11-05T03:00:00Z"));
        assertThat(o1).isNotNull();
        base = "machineId=" + m1;
    }

    // ---- 7. definitions ----

    @Test
    void summaryFollowsTheDefinitions() throws Exception {
        JsonNode s = data(SUMMARY + "?from=2025-11-01&to=2025-11-14&" + base);
        assertThat(s.path("ordersSold").asLong()).isEqualTo(2);
        assertThat(s.path("grossSales").asLong()).isEqualTo(55000);
        assertThat(s.path("discounts").asLong()).isZero();
        assertThat(s.path("netSales").asLong()).isEqualTo(55000);
        assertThat(s.path("deliveredRefunds").asLong()).isEqualTo(20000);
        assertThat(s.path("netRevenue").asLong()).isEqualTo(35000);
        assertThat(s.path("averageOrderValue").asLong()).isEqualTo(27500);
        // o2 + duplicate (paid 01/11 00:29 and 00:35 VN), o3, f1, l1; o1 was paid on 31/10 VN.
        assertThat(s.path("moneyCollected").asLong()).isEqualTo(35000 * 4 + 20000);
        assertThat(s.path("moneyRefunded").path("total").asLong()).isEqualTo(20000 + 35000 * 3);
        assertThat(s.path("moneyRefunded").path("byReason").path("PRODUCT_QUALITY").asLong()).isEqualTo(20000);
        assertThat(s.path("moneyRefunded").path("byReason").path("DISPENSE_FAILED").asLong()).isEqualTo(35000);
        assertThat(s.path("moneyRefunded").path("byReason").path("LATE_PAYMENT").asLong()).isEqualTo(35000);
        assertThat(s.path("moneyRefunded").path("byReason").path("DUPLICATE_PAYMENT").asLong()).isEqualTo(35000);
        assertThat(s.path("moneyRefunded").path("byReason").path("OTHER").asLong()).isZero();
        assertThat(s.path("failedDispenses").asLong()).isEqualTo(1);
        assertThat(s.path("pendingRefunds").has("count")).isTrue();
        assertThat(s.path("filters").path("zone").asText()).isEqualTo("Asia/Ho_Chi_Minh");
        assertThat(s.path("filters").path("machineIds").get(0).asText()).isEqualTo(m1.toString());
        assertThat(s.path("generatedAt").isTextual()).isTrue();
    }

    @Test
    void daysFollowTheBusinessZone() throws Exception {
        JsonNode october = data(SUMMARY + "?from=2025-10-31&to=2025-10-31&" + base);
        assertThat(october.path("ordersSold").asLong()).isEqualTo(1);
        assertThat(october.path("grossSales").asLong()).isEqualTo(35000);
        assertThat(october.path("discounts").asLong()).isEqualTo(5000);
        assertThat(october.path("netSales").asLong()).isEqualTo(30000);
        assertThat(data(SUMMARY + "?from=2025-11-01&to=2025-11-01&" + base).path("ordersSold").asLong()).isEqualTo(1);
    }

    @Test
    void refundsLandInTheirOwnPeriodAndUndeliveredOrdersAreNeverSales() throws Exception {
        JsonNode early = data(SUMMARY + "?from=2025-11-01&to=2025-11-05&" + base);
        assertThat(early.path("ordersSold").asLong()).isEqualTo(2);
        assertThat(early.path("deliveredRefunds").asLong()).isZero();
        assertThat(early.path("moneyRefunded").path("byReason").path("DISPENSE_FAILED").asLong()).isEqualTo(35000);
        JsonNode late = data(SUMMARY + "?from=2025-11-06&to=2025-11-14&" + base);
        assertThat(late.path("ordersSold").asLong()).isZero();
        assertThat(late.path("deliveredRefunds").asLong()).isEqualTo(20000);
        assertThat(late.path("netRevenue").asLong()).isEqualTo(-20000);
        assertThat(late.path("averageOrderValue").asLong()).isZero();
        assertThat(late.path("moneyCollected").asLong()).isZero();
        // f1 (failed, refunded, never completed) and l1 (late) are not sales anywhere.
        JsonNode all = data(SUMMARY + "?from=2025-10-01&to=2025-11-30&" + base);
        assertThat(all.path("ordersSold").asLong()).isEqualTo(3);
        assertThat(all.path("failedDispenses").asLong()).isEqualTo(1);
    }

    @Test
    void machineAndProductFiltersAndValidation() throws Exception {
        String range = "?from=2025-10-01&to=2025-11-30";
        assertThat(data(SUMMARY + range + "&machineId=" + m2).path("ordersSold").asLong()).isEqualTo(1);
        assertThat(data(SUMMARY + range + "&machineId=" + m1 + "&machineId=" + m2).path("ordersSold").asLong()).isEqualTo(4);
        assertThat(data(SUMMARY + range + "&" + base + "&productId=" + q).path("ordersSold").asLong()).isEqualTo(1);
        assertThat(data(SUMMARY + range + "&" + base + "&productId=" + q).path("grossSales").asLong()).isEqualTo(20000);
        assertThat(data(SUMMARY + range + "&" + base + "&productId=" + p + "&productId=" + q).path("ordersSold").asLong()).isEqualTo(3);
        UUID unknown = UUID.randomUUID();
        assertThat(fixtures.response("GET", SUMMARY + range + "&machineId=" + unknown, null, admin.token(), 400).toString()).contains(unknown.toString());
        assertThat(fixtures.response("GET", SUMMARY + range + "&productId=" + unknown, null, admin.token(), 400).toString()).contains(unknown.toString());
        fixtures.response("GET", SUMMARY + "?from=2025-11-02&to=2025-11-01", null, admin.token(), 400);
        fixtures.response("GET", SUMMARY + "?from=2025-01-01&to=2026-01-02", null, admin.token(), 400);
        fixtures.response("GET", SUMMARY + "?from=2025-01-01&to=2026-01-01&" + base, null, admin.token(), 200);
        fixtures.response("GET", SUMMARY + "?from=2025-01-01", null, admin.token(), 400);
        StringBuilder many = new StringBuilder(SUMMARY + range);
        for (int i = 0; i < 21; i++) many.append("&machineId=").append(m1);
        fixtures.response("GET", many.toString(), null, admin.token(), 200); // duplicates collapse
        many = new StringBuilder(SUMMARY + range);
        for (int i = 0; i < 21; i++) many.append("&machineId=").append(UUID.randomUUID());
        fixtures.response("GET", many.toString(), null, admin.token(), 400);
    }

    // ---- 8. series, peak hours, products, machines ----

    @Test
    void seriesAreZeroFilledInTheBusinessZone() throws Exception {
        JsonNode day = data("/api/v1/reports/sales/timeseries?granularity=DAY&from=2025-10-31&to=2025-11-14&" + base).path("buckets");
        assertThat(day).hasSize(15);
        assertThat(day.get(0).path("start").asText()).isEqualTo("2025-10-31");
        assertThat(day.get(0).path("netSales").asLong()).isEqualTo(30000);
        assertThat(day.get(1).path("ordersSold").asLong()).isEqualTo(1);
        assertThat(day.get(2).path("grossSales").asLong()).isEqualTo(20000);
        assertThat(day.get(3).path("ordersSold").asLong()).isZero();
        assertThat(day.get(10).path("start").asText()).isEqualTo("2025-11-10");
        assertThat(day.get(10).path("deliveredRefunds").asLong()).isEqualTo(20000);
        assertThat(day.get(10).path("netRevenue").asLong()).isEqualTo(-20000);

        JsonNode week = data("/api/v1/reports/sales/timeseries?granularity=WEEK&from=2025-10-29&to=2025-11-16&" + base).path("buckets");
        assertThat(week).hasSize(3);
        assertThat(week.get(0).path("start").asText()).isEqualTo("2025-10-29"); // clipped; ISO week of Monday 27/10
        assertThat(week.get(0).path("end").asText()).isEqualTo("2025-11-02");
        assertThat(week.get(0).path("ordersSold").asLong()).isEqualTo(3);
        assertThat(week.get(1).path("start").asText()).isEqualTo("2025-11-03");
        assertThat(week.get(1).path("ordersSold").asLong()).isZero();
        assertThat(week.get(2).path("deliveredRefunds").asLong()).isEqualTo(20000);

        JsonNode month = data("/api/v1/reports/sales/timeseries?granularity=MONTH&from=2025-10-15&to=2025-12-31&" + base).path("buckets");
        assertThat(month).hasSize(3);
        assertThat(month.get(0).path("start").asText()).isEqualTo("2025-10-15");
        assertThat(month.get(0).path("end").asText()).isEqualTo("2025-10-31");
        assertThat(month.get(0).path("ordersSold").asLong()).isEqualTo(1);
        assertThat(month.get(1).path("ordersSold").asLong()).isEqualTo(2);
        assertThat(month.get(2).path("ordersSold").asLong()).isZero();
    }

    @Test
    void peakHoursAndTheWeekdayMatrix() throws Exception {
        JsonNode peak = data("/api/v1/reports/sales/peak-hours?from=2025-11-01&to=2025-11-14&" + base);
        assertThat(peak.path("hours")).hasSize(24);
        assertThat(peak.path("hours").get(0).path("ordersSold").asLong()).isEqualTo(1);
        assertThat(peak.path("hours").get(0).path("netSales").asLong()).isEqualTo(35000);
        assertThat(peak.path("hours").get(10).path("ordersSold").asLong()).isEqualTo(1);
        assertThat(peak.path("hours").get(23).path("ordersSold").asLong()).isZero();
        assertThat(peak.path("weekdayHours")).hasSize(7);
        for (JsonNode day : peak.path("weekdayHours")) assertThat(day).hasSize(24);
        assertThat(peak.path("weekdayHours").get(5).get(0).asLong()).isEqualTo(1); // Saturday 01/11 00:30
        assertThat(peak.path("weekdayHours").get(6).get(10).asLong()).isEqualTo(1); // Sunday 02/11 10:00
    }

    @Test
    void productsSortTieLimitAndShare() throws Exception {
        String range = "?from=2025-11-01&to=2025-11-14&" + base;
        JsonNode byNet = data("/api/v1/reports/sales/products" + range).path("products");
        assertThat(byNet).hasSize(2);
        assertThat(byNet.get(0).path("productId").asText()).isEqualTo(p.toString());
        assertThat(byNet.get(0).path("sharePercent").decimalValue()).isEqualByComparingTo("63.6");
        assertThat(byNet.get(1).path("sharePercent").decimalValue()).isEqualByComparingTo("36.4");
        assertThat(byNet.get(1).path("status").asText()).isEqualTo("INACTIVE");
        assertThat(byNet.get(1).path("deliveredRefunds").asLong()).isEqualTo(20000);
        // Equal quantities: by name in the database collation, then id.
        JsonNode byQuantity = data("/api/v1/reports/sales/products" + range + "&sortBy=QUANTITY").path("products");
        UUID firstByName = jdbc.queryForObject("SELECT id FROM products WHERE id IN (?, ?) ORDER BY name, id LIMIT 1", UUID.class, p, q);
        assertThat(byQuantity.get(0).path("productId").asText()).isEqualTo(firstByName.toString());
        assertThat(byQuantity.get(0).path("quantity").asLong()).isEqualTo(byQuantity.get(1).path("quantity").asLong());
        assertThat(data("/api/v1/reports/sales/products" + range + "&limit=1").path("products")).hasSize(1);
        fixtures.response("GET", "/api/v1/reports/sales/products" + range + "&limit=0", null, admin.token(), 400);
        fixtures.response("GET", "/api/v1/reports/sales/products" + range + "&limit=101", null, admin.token(), 400);
        JsonNode none = data("/api/v1/reports/sales/products?from=2025-12-01&to=2025-12-02&" + base).path("products");
        assertThat(none).isEmpty();
    }

    @Test
    void seriesProductsAndMachinesAddUpToTheSummary() throws Exception {
        String range = "?from=2025-10-01&to=2025-11-30&machineId=" + m1 + "&machineId=" + m2;
        JsonNode s = data(SUMMARY + range);
        long orders = 0, net = 0, gross = 0, discounts = 0, refunds = 0;
        for (JsonNode b : data("/api/v1/reports/sales/timeseries" + range).path("buckets")) {
            orders += b.path("ordersSold").asLong();
            net += b.path("netSales").asLong();
            gross += b.path("grossSales").asLong();
            discounts += b.path("discounts").asLong();
            refunds += b.path("deliveredRefunds").asLong();
        }
        assertThat(List.of(orders, gross, discounts, net, refunds)).containsExactly(s.path("ordersSold").asLong(), s.path("grossSales").asLong(),
                s.path("discounts").asLong(), s.path("netSales").asLong(), s.path("deliveredRefunds").asLong());
        long productNet = 0, productRefunds = 0, quantity = 0;
        for (JsonNode pr : data("/api/v1/reports/sales/products" + range + "&limit=100").path("products")) {
            productNet += pr.path("netSales").asLong();
            productRefunds += pr.path("deliveredRefunds").asLong();
            quantity += pr.path("quantity").asLong();
        }
        assertThat(productNet).isEqualTo(s.path("netSales").asLong());
        assertThat(productRefunds).isEqualTo(s.path("deliveredRefunds").asLong());
        assertThat(quantity).isEqualTo(s.path("ordersSold").asLong());
        JsonNode machines = data("/api/v1/reports/sales/machines" + range).path("machines");
        assertThat(machines).hasSize(2);
        long machineOrders = 0, machineRevenue = 0;
        for (JsonNode m : machines) {
            machineOrders += m.path("ordersSold").asLong();
            machineRevenue += m.path("netRevenue").asLong();
        }
        assertThat(machineOrders).isEqualTo(s.path("ordersSold").asLong());
        assertThat(machineRevenue).isEqualTo(s.path("netRevenue").asLong());
        assertThat(machines.get(0).path("machineId").asText()).isEqualTo(m1.toString());
        assertThat(machines.get(0).path("netRevenue").asLong()).isEqualTo(30000 + 35000 + 20000 - 20000);
        long peak = 0;
        for (JsonNode h : data("/api/v1/reports/sales/peak-hours" + range).path("hours")) peak += h.path("ordersSold").asLong();
        assertThat(peak).isEqualTo(s.path("ordersSold").asLong());
    }

    // ---- 9. export ----

    @Test
    void csvAndPdfCarryTheSameNumbersAsTheReport() throws Exception {
        String range = "?from=2025-10-01&to=2025-11-30&" + base;
        JsonNode s = data(SUMMARY + range);
        long audits = count("SELECT count(*) FROM audit_logs WHERE action='REPORT_EXPORTED'");

        MockHttpServletResponse csv = export(range, "CSV");
        assertThat(csv.getContentType()).startsWith("text/csv");
        assertThat(csv.getHeader("Content-Disposition")).isEqualTo("attachment; filename=\"freshvend-sales_2025-10-01_2025-11-30.csv\"");
        assertThat(csv.getHeader("Cache-Control")).isEqualTo("no-store");
        byte[] bytes = csv.getContentAsByteArray();
        assertThat(bytes[0]).isEqualTo((byte) 0xEF);
        assertThat(bytes[1]).isEqualTo((byte) 0xBB);
        assertThat(bytes[2]).isEqualTo((byte) 0xBF);
        String text = new String(bytes, StandardCharsets.UTF_8).substring(1);
        Map<String, List<List<String>>> sections = sections(text);
        assertThat(sections.keySet()).containsExactly("Filters", "Summary", "Daily", "Products", "Peak hours", "Machines");
        Map<String, Long> csvSummary = new LinkedHashMap<>();
        for (List<String> row : sections.get("Summary").subList(1, sections.get("Summary").size())) csvSummary.put(row.get(0), Long.parseLong(row.get(1)));
        Map<String, Long> expected = expectedSummary(s);
        assertThat(csvSummary).isEqualTo(expected);
        assertThat(sections.get("Daily")).hasSize(1 + 61);
        assertThat(sections.get("Peak hours")).hasSize(1 + 24);
        // Formula guard: the product name is text, never a formula; Vietnamese stays readable.
        assertThat(text).contains("\"'=HYPERLINK(\"\"x\"\")\"").contains("Dưa hấu");
        List<String> qRow = sections.get("Products").stream().filter(r -> r.get(0).equals(q.toString())).findFirst().orElseThrow();
        assertThat(qRow.get(2)).isEqualTo("'=HYPERLINK(\"x\")");
        assertThat(sections.get("Filters").stream().filter(r -> r.get(0).equals("generatedBy")).findFirst().orElseThrow().get(1)).isNotBlank();

        MockHttpServletResponse pdf = export(range, "PDF");
        assertThat(pdf.getContentType()).isEqualTo("application/pdf");
        assertThat(pdf.getHeader("Content-Disposition")).isEqualTo("attachment; filename=\"freshvend-sales_2025-10-01_2025-11-30.pdf\"");
        assertThat(pdf.getHeader("Cache-Control")).isEqualTo("no-store");
        String pdfText;
        try (var document = Loader.loadPDF(pdf.getContentAsByteArray())) {
            pdfText = new PDFTextStripper().getText(document);
        }
        assertThat(pdfText).contains("Dưa hấu", "Báo cáo bán hàng", "Tổng quan", "₫");
        Map<String, Long> pdfSummary = new LinkedHashMap<>();
        Matcher m = Pattern.compile("\\(([A-Za-z.]+(?:_[A-Z]+)*)\\)\\s+(-?[0-9.]+)").matcher(pdfText);
        while (m.find()) pdfSummary.put(m.group(1), Long.parseLong(m.group(2).replace(".", "")));
        assertThat(pdfSummary).isEqualTo(expected);
        assertThat(pdfText).contains("30.000 ₫").contains("2025-10-31");

        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='REPORT_EXPORTED'")).isEqualTo(audits + 2);
        Map<String, Object> audit = jdbc.queryForMap("SELECT user_id, ip_address, new_value::text AS v FROM audit_logs WHERE action='REPORT_EXPORTED' ORDER BY created_at DESC LIMIT 1");
        assertThat(audit.get("user_id")).isEqualTo(admin.id());
        assertThat(audit.get("ip_address")).isNotNull();
        assertThat((String) audit.get("v")).contains("\"format\": \"PDF\"").contains("2025-10-01").contains(m1.toString());
        fixtures.response("GET", "/api/v1/reports/sales/export?format=XLSX&from=2025-10-01&to=2025-10-02", null, admin.token(), 400);
    }

    // ---- 11. security ----

    @Test
    void staffAnonymousAndKiosksHaveNoAccessToReports() throws Exception {
        String range = "?from=2025-11-01&to=2025-11-02";
        for (String path : List.of("summary", "timeseries", "peak-hours", "products", "machines")) {
            fixtures.response("GET", "/api/v1/reports/sales/" + path + range, null, staff.token(), 403);
            fixtures.response("GET", "/api/v1/reports/sales/" + path + range, null, null, 401);
        }
        fixtures.response("GET", "/api/v1/reports/sales/export" + range + "&format=CSV", null, staff.token(), 403);
        fixtures.response("GET", "/api/v1/reports/sales/export" + range + "&format=CSV", null, null, 401);
    }

    // ---- helpers ----

    private Map<String, Long> expectedSummary(JsonNode s) {
        Map<String, Long> expected = new LinkedHashMap<>();
        for (String key : List.of("ordersSold", "grossSales", "discounts", "netSales", "deliveredRefunds", "netRevenue", "averageOrderValue", "moneyCollected")) {
            expected.put(key, s.path(key).asLong());
        }
        expected.put("moneyRefunded", s.path("moneyRefunded").path("total").asLong());
        s.path("moneyRefunded").path("byReason").fields().forEachRemaining(e -> expected.put("moneyRefunded." + e.getKey(), e.getValue().asLong()));
        expected.put("pendingRefunds.count", s.path("pendingRefunds").path("count").asLong());
        expected.put("pendingRefunds.amount", s.path("pendingRefunds").path("amount").asLong());
        expected.put("failedDispenses", s.path("failedDispenses").asLong());
        return expected;
    }

    private MockHttpServletResponse export(String range, String format) throws Exception {
        var response = mvc.perform(get("/api/v1/reports/sales/export" + range + "&format=" + format).header("Authorization", "Bearer " + admin.token()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return response;
    }

    /** RFC 4180 reader for the test: sections start with a [Name] line and end with a blank line. */
    private static Map<String, List<List<String>>> sections(String text) throws Exception {
        Map<String, List<List<String>>> result = new LinkedHashMap<>();
        List<List<String>> rows = parse(text);
        String current = null;
        for (List<String> row : rows) {
            if (row.size() == 1 && row.get(0).isEmpty()) {
                current = null;
                continue;
            }
            if (current == null) {
                current = row.get(0).substring(1, row.get(0).length() - 1);
                result.put(current, new ArrayList<>());
                continue;
            }
            result.get(current).add(row);
        }
        return result;
    }

    private static List<List<String>> parse(String text) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < text.length() && text.charAt(i + 1) == '"') { cell.append('"'); i++; }
                else if (c == '"') quoted = false;
                else cell.append(c);
            } else if (c == '"') quoted = true;
            else if (c == ',') { row.add(cell.toString()); cell.setLength(0); }
            else if (c == '\r') { }
            else if (c == '\n') { row.add(cell.toString()); cell.setLength(0); rows.add(row); row = new ArrayList<>(); }
            else cell.append(c);
        }
        if (cell.length() > 0 || !row.isEmpty()) { row.add(cell.toString()); rows.add(row); }
        return rows;
    }

    private JsonNode data(String path) throws Exception {
        return fixtures.api("GET", path, null, admin.token(), 200);
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private UUID product(String name, int price, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO products (id, sku, name, price, status) VALUES (?, ?, ?, ?, ?)", id, "RPT-" + id.toString().substring(0, 8), name, price, status);
        return id;
    }

    private UUID sale(UUID machine, UUID product, int subtotal, int discount, Instant completedAt) {
        return order(machine, product, subtotal, discount, "COMPLETED", completedAt.minusSeconds(60), completedAt);
    }

    /** An order with one item and its paying payment (paid one minute before completion, created two minutes before). */
    private UUID order(UUID machine, UUID product, int subtotal, int discount, String status, Instant paidAt, Instant completedAt) {
        UUID id = UUID.randomUUID();
        Instant created = paidAt.minusSeconds(60);
        jdbc.update("INSERT INTO orders (id, order_code, machine_id, status, subtotal, discount_amount, total_amount, created_at, paid_at, completed_at, cancelled_at)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, "ORD-RPT-" + id.toString().substring(0, 8).toUpperCase(), machine, status, subtotal, discount,
                subtotal - discount, Timestamp.from(created), Timestamp.from(paidAt), completedAt == null ? null : Timestamp.from(completedAt),
                status.equals("CANCELLED") ? Timestamp.from(created) : null);
        jdbc.update("INSERT INTO order_items (order_id, product_id, quantity, original_unit_price, unit_price, total_price, discount_percent, discount_reason)"
                + " VALUES (?, ?, 1, ?, ?, ?, ?, ?)", id, product, subtotal, subtotal - discount, subtotal - discount, discount == 0 ? 0 : 15,
                discount == 0 ? "NONE" : "NEAR_EXPIRY");
        payment(id, subtotal - discount, paidAt);
        return id;
    }

    private UUID payment(UUID order, int amount, Instant paidAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO payments (id, order_id, provider, transaction_id, payment_reference, amount, status, created_at, paid_at)"
                + " VALUES (?, ?, 'TESTPAY', ?, ?, ?, 'SUCCESS', ?, ?)", id, order, "TX-" + id, "REF-" + id, amount, Timestamp.from(paidAt.minusSeconds(30)),
                Timestamp.from(paidAt));
        return id;
    }

    private void refund(UUID payment, String reason, Instant at) {
        jdbc.update("UPDATE payments SET status='REFUNDED', refunded_at=?, refunded_by=?, refund_reason=?, refund_transfer_ref=? WHERE id=?",
                Timestamp.from(at), admin.id(), reason, "FT-" + payment.toString().substring(0, 18), payment);
    }

    private UUID paymentOf(UUID order) {
        return jdbc.queryForObject("SELECT id FROM payments WHERE order_id=? ORDER BY paid_at LIMIT 1", UUID.class, order);
    }

    private static Instant at(String instant) {
        return Instant.parse(instant);
    }

    private static Timestamp ts(String instant) {
        return Timestamp.from(Instant.parse(instant));
    }
}
