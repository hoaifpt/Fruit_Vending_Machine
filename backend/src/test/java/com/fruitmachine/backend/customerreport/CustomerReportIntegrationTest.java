package com.fruitmachine.backend.customerreport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.customerreport.ratelimit.SlidingWindowRateLimiter;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.dispense.service.MachineCommandGateway;
import com.fruitmachine.backend.payment.gateway.HmacSha256;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/** Issue #74: public customer reports, verification, work orders, refunds link, admin review, rate limits and schema. */
@Import(CustomerReportIntegrationTest.ConnectedTransport.class)
@ExtendWith(OutputCaptureExtension.class)
class CustomerReportIntegrationTest extends AbstractWebhookIntegrationTest {
    static final String SECRET = "test-only-report-ip-hash-secret";
    static final String PHONE = "0901234567";
    static final String EMAIL = "an.nguyen@example.com";
    static final AtomicInteger NEXT_IP = new AtomicInteger(1);

    @Autowired DispenseService dispense;
    @Autowired SlidingWindowRateLimiter limiter;

    /** Each test submits from its own address so per-source limits never leak between tests. */
    String ip;

    @BeforeEach
    void freshSource() {
        limiter.reset();
        int n = NEXT_IP.getAndIncrement();
        ip = "192.0.2." + (n % 250 + 1);
    }

    // ---- 6. migration ----

    @Test
    void everyMachineHasAUniqueTokenAndTheChecksHold() throws Exception {
        UUID first = fixtures.machine(admin.token()), second = fixtures.machine(admin.token());
        assertThat(count("SELECT count(*) FROM machines WHERE report_token IS NULL")).isZero();
        assertThat(count("SELECT count(*) FROM machines")).isEqualTo(count("SELECT count(DISTINCT report_token) FROM machines"));
        assertThat(token(first)).matches("^[A-Za-z0-9_-]{22,32}$").isNotEqualTo(token(second));
        assertThatThrownBy(() -> jdbc.update("UPDATE machines SET report_token=? WHERE id=?", token(first), second)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE machines SET report_token='short' WHERE id=?", first)).isInstanceOf(DataIntegrityViolationException.class);

        String insert = "INSERT INTO customer_reports (code, machine_id, type, description, order_code_input, verdict, status, resolution, resolved_at, source_ip_hash)"
                + " VALUES (?, ?, ?, ?, ?, 'NOT_APPLICABLE', ?, ?, ?::timestamptz, 'x')";
        assertThatThrownBy(() -> jdbc.update(insert, "RPT-T-1", first, "PAID_NOT_RECEIVED", null, null, "NEW", null, null)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "RPT-T-2", first, "MACHINE_FAULT", "  ", null, "NEW", null, null)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "RPT-T-3", first, "OTHER", "x", null, "RESOLVED", null, null)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "RPT-T-4", first, "OTHER", "x", null, "NEW", "FIXED", Instant.now().toString())).isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update(insert, "RPT-T-5", first, "OTHER", "x", null, "RESOLVED", "FIXED", Instant.now().toString());
        assertThat(count("SELECT count(*) FROM customer_reports WHERE code='RPT-T-5'")).isEqualTo(1);
    }

    // ---- 7. public submit ----

    @Test
    void eachTypeIsAcceptedWithACodeAndOnlyTheAddressHashIsStored(CapturedOutput output) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String token = token(machine);
        JsonNode form = publicJson(get("/api/v1/public/report-forms/" + token), 200).path("data");
        assertThat(form.path("machineCode").asText()).isEqualTo(code(machine));
        assertThat(form.path("types")).hasSize(4);
        assertThat(form.path("maxPhotos").asInt()).isEqualTo(3);
        assertThat(form.path("maxPhotoBytes").asInt()).isEqualTo(2 * 1024 * 1024);

        PlacedOrder order = failedOrder();
        List<String> codes = new ArrayList<>();
        codes.add(submit(token(order), report("PAID_NOT_RECEIVED", order.orderCode().toLowerCase(), null), 201).path("data").path("reportCode").asText());
        codes.add(submit(token, report("PRODUCT_QUALITY", null, "Táo bị dập"), 201).path("data").path("reportCode").asText());
        codes.add(submit(token, withoutContact(report("MACHINE_FAULT", null, "Màn hình bị đơ"))).path("data").path("reportCode").asText());
        codes.add(submit(token, withoutContact(report("OTHER", null, "Góp ý"))).path("data").path("reportCode").asText());
        for (String code : codes) assertThat(code).matches("^RPT-\\d{8}-[0-9A-Z]{4}$");
        assertThat(codes).doesNotHaveDuplicates();

        Map<String, Object> stored = jdbc.queryForMap("SELECT * FROM customer_reports WHERE code=?", codes.getFirst());
        assertThat(stored.get("order_code_input")).isEqualTo(order.orderCode());
        assertThat(stored.get("source_ip_hash")).isEqualTo(HmacSha256.hex(SECRET, ip));
        assertThat(jdbc.queryForList("SELECT * FROM customer_reports").toString()).doesNotContain(ip);
        assertThat(output.getAll()).doesNotContain(ip, PHONE, EMAIL);
    }

    @Test
    void unknownRotatedAndInactiveTokensAreNotFound() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String old = token(machine);
        JsonNode unknown = publicJson(get("/api/v1/public/report-forms/" + "A".repeat(22)), 404);
        publicJson(get("/api/v1/public/report-forms/bad"), 404);
        fixtures.api("POST", "/api/v1/machines/" + machine + "/report-token/rotate", null, admin.token(), 200);
        JsonNode rotated = publicJson(get("/api/v1/public/report-forms/" + old), 404);
        submit(old, withoutContact(report("OTHER", null, "x")), 404);
        assertThat(rotated.path("message").asText()).isEqualTo(unknown.path("message").asText());
        publicJson(get("/api/v1/public/report-forms/" + token(machine)), 200);
        fixtures.api("PATCH", "/api/v1/machines/" + machine + "/status", Map.of("status", "INACTIVE"), admin.token(), 200);
        assertThat(publicJson(get("/api/v1/public/report-forms/" + token(machine)), 404).path("message").asText()).isEqualTo(unknown.path("message").asText());
    }

    @Test
    void invalidSubmissionsAreRejected() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        long before = count("SELECT count(*) FROM customer_reports");
        limiter.reset();
        submit(token, report("PAID_NOT_RECEIVED", null, null), 400);
        limiter.reset();
        submit(token, report("PAID_NOT_RECEIVED", "ORD-1", null), 400);
        limiter.reset();
        submit(token, report("PRODUCT_QUALITY", null, "   "), 400);
        limiter.reset();
        submit(token, report("MACHINE_FAULT", null, "x".repeat(1001)), 400);
        var noContact = withoutContact(report("PRODUCT_QUALITY", null, "x"));
        limiter.reset();
        submit(token, noContact, 400);
        var badPhone = report("PRODUCT_QUALITY", null, "x");
        badPhone.put("contactPhone", "12345");
        limiter.reset();
        submit(token, badPhone, 400);
        var badMail = report("PRODUCT_QUALITY", null, "x");
        badMail.put("contactPhone", null);
        badMail.put("contactEmail", "not-an-email");
        limiter.reset();
        submit(token, badMail, 400);
        var noConsent = report("OTHER", null, "x");
        noConsent.put("consent", false);
        limiter.reset();
        submit(token, noConsent, 400);
        var unknown = report("OTHER", null, "x");
        unknown.put("bankAccount", "123");
        limiter.reset();
        submit(token, unknown, 400);
        var badType = report("OTHER", null, "x");
        badType.put("type", "REFUND_ME");
        limiter.reset();
        submit(token, badType, 400);
        limiter.reset();
        // Missing report part.
        perform(multipart("/api/v1/public/report-forms/" + token + "/reports"), 400);
        assertThat(count("SELECT count(*) FROM customer_reports")).isEqualTo(before);
        // Control characters are removed, newlines kept, the e-mail alone is enough.
        var clean = report("PRODUCT_QUALITY", null, "  Táo\u0007 bị\ndập  ");
        clean.put("contactPhone", null);
        String code = submit(token, clean, 201).path("data").path("reportCode").asText();
        assertThat(jdbc.queryForObject("SELECT description FROM customer_reports WHERE code=?", String.class, code)).isEqualTo("Táo bị\ndập");
    }

    @Test
    void theHoneypotIsAcceptedSilentlyAndNothingIsStored() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        long reports = count("SELECT count(*) FROM customer_reports"), workOrders = count("SELECT count(*) FROM work_orders");
        var bot = report("MACHINE_FAULT", null, "spam");
        bot.put("website", "http://spam.example");
        JsonNode body = submit(token, bot, 201).path("data");
        assertThat(body.path("reportCode").asText()).matches("^RPT-\\d{8}-[0-9A-Z]{4}$");
        assertThat(count("SELECT count(*) FROM customer_reports")).isEqualTo(reports);
        assertThat(count("SELECT count(*) FROM work_orders")).isEqualTo(workOrders);
    }

    @Test
    void photosAreCheckedByContentReEncodedAndLimited() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        byte[] png = image("png", 40, 30);
        byte[] jpegWithExif = withExif(image("jpg", 40, 30));
        assertThat(new String(jpegWithExif, StandardCharsets.ISO_8859_1)).contains("Exif", "GPS-SECRET-LOCATION");
        String code = submitWithPhotos(token, withoutContact(report("MACHINE_FAULT", null, "Kẹt khay")), 201,
                new MockMultipartFile("photos", "renamed.jpg", "image/jpeg", png),
                new MockMultipartFile("photos", "camera.jpg", "image/jpeg", jpegWithExif)).path("data").path("reportCode").asText();
        List<Map<String, Object>> photos = jdbc.queryForList("SELECT p.content_type, p.size_bytes, p.data FROM customer_report_photos p"
                + " JOIN customer_reports r ON r.id = p.report_id WHERE r.code=? ORDER BY p.created_at, p.id", code);
        assertThat(photos).hasSize(2);
        assertThat(photos).extracting(p -> p.get("content_type")).containsExactlyInAnyOrder("image/png", "image/jpeg");
        for (var photo : photos) {
            byte[] data = (byte[]) photo.get("data");
            assertThat(photo.get("size_bytes")).isEqualTo(data.length);
            String text = new String(data, StandardCharsets.ISO_8859_1);
            assertThat(text).doesNotContain("Exif", "GPS-SECRET-LOCATION");
            assertThat(ImageIO.read(new java.io.ByteArrayInputStream(data)).getWidth()).isEqualTo(40);
        }

        var text = new MockMultipartFile("photos", "photo.jpg", "image/jpeg", "this is not an image".getBytes(StandardCharsets.UTF_8));
        submitWithPhotos(token, withoutContact(report("OTHER", null, "x")), 400, text);
        byte[] big = new byte[2 * 1024 * 1024 + 1];
        System.arraycopy(png, 0, big, 0, png.length);
        submitWithPhotos(token, withoutContact(report("OTHER", null, "x")), 400, new MockMultipartFile("photos", "big.png", "image/png", big));
        limiter.reset();
        var four = new MockMultipartFile[4];
        for (int i = 0; i < 4; i++) four[i] = new MockMultipartFile("photos", "p" + i + ".png", "image/png", png);
        submitWithPhotos(token, withoutContact(report("OTHER", null, "x")), 400, four);
        submitWithPhotos(token, withoutContact(report("OTHER", null, "x")), 400,
                new MockMultipartFile("photos", "huge.png", "image/png", image("png", 4001, 1)));
    }

    @Test
    void theResponseIsTheSameWhateverTheOrder() throws Exception {
        PlacedOrder order = failedOrder();
        JsonNode real = submit(token(order), report("PAID_NOT_RECEIVED", order.orderCode(), null), 201);
        JsonNode fake = submit(token(order), report("PAID_NOT_RECEIVED", "ORD-20200101-AAAAAAAA", null), 201);
        assertThat(real.path("data").path("message")).isEqualTo(fake.path("data").path("message"));
        assertThat(real.path("message")).isEqualTo(fake.path("message"));
        assertThat(fieldNames(real)).isEqualTo(fieldNames(fake));
        assertThat(fieldNames(real.path("data"))).containsExactly("reportCode", "message");
    }

    @Test
    void noCredentialIsNeededAndEverythingElseStaysProtected() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        // A stale or garbage bearer token is ignored on the public form.
        assertThat(mvc.perform(get("/api/v1/public/report-forms/" + token).header("Authorization", "Bearer not-a-token")
                .with(r -> { r.setRemoteAddr(ip); return r; })).andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(mvc.perform(get("/api/v1/customer-reports")).andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(mvc.perform(get("/api/v1/public")).andReturn().getResponse().getStatus()).isNotIn(401, 403);
        assertThat(mvc.perform(get("/api/v1/machines")).andReturn().getResponse().getStatus()).isEqualTo(401);
        // CORS: the configured web origin only.
        var preflight = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options("/api/v1/public/report-forms/" + token + "/reports")
                .header("Origin", "https://report.test.invalid").header("Access-Control-Request-Method", "POST");
        assertThat(mvc.perform(preflight).andReturn().getResponse().getHeader("Access-Control-Allow-Origin")).isEqualTo("https://report.test.invalid");
        var foreign = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options("/api/v1/public/report-forms/" + token + "/reports")
                .header("Origin", "https://evil.example").header("Access-Control-Request-Method", "POST");
        assertThat(mvc.perform(foreign).andReturn().getResponse().getStatus()).isEqualTo(403);
    }

    // ---- 8. rate limiting ----

    @Test
    void theSixthSubmissionPerMinuteFromOneSourceIsLimited() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        for (int i = 0; i < 5; i++) submit(token, withoutContact(report("OTHER", null, "x")), i == 0 ? 201 : 201);
        MvcResult limited = raw(token, withoutContact(report("OTHER", null, "x")), ip, null);
        assertThat(limited.getResponse().getStatus()).isEqualTo(429);
        assertThat(Long.parseLong(limited.getResponse().getHeader("Retry-After"))).isBetween(1L, 60L);
        // Invalid bodies are counted too (before validation) and still limited.
        assertThat(raw(token, Map.of("type", "NOPE"), ip, null).getResponse().getStatus()).isEqualTo(429);
        assertThat(raw(token, withoutContact(report("OTHER", null, "x")), "198.51.100.7", null).getResponse().getStatus()).isEqualTo(201);
        clock.advance(Duration.ofSeconds(61));
        assertThat(raw(token, withoutContact(report("OTHER", null, "x")), ip, null).getResponse().getStatus()).isEqualTo(201);
    }

    @Test
    void forwardedForIsHonouredOnlyFromATrustedProxy() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        // Untrusted remote: rotating X-Forwarded-For does not escape the limit.
        for (int i = 0; i < 5; i++) assertThat(raw(token, withoutContact(report("OTHER", null, "x")), ip, "203.0.113." + i).getResponse().getStatus()).isEqualTo(201);
        assertThat(raw(token, withoutContact(report("OTHER", null, "x")), ip, "203.0.113.99").getResponse().getStatus()).isEqualTo(429);
        // Trusted proxy (10.9.9.9 in the test profile): each forwarded client has its own budget, and its hash is stored.
        for (int i = 0; i < 5; i++) assertThat(raw(token, withoutContact(report("OTHER", null, "x")), "10.9.9.9", "203.0.113.50").getResponse().getStatus()).isEqualTo(201);
        assertThat(raw(token, withoutContact(report("OTHER", null, "x")), "10.9.9.9", "203.0.113.50").getResponse().getStatus()).isEqualTo(429);
        assertThat(raw(token, withoutContact(report("OTHER", null, "x")), "10.9.9.9", "203.0.113.51, 10.9.9.9").getResponse().getStatus()).isEqualTo(201);
        assertThat(count("SELECT count(*) FROM customer_reports WHERE source_ip_hash=?", HmacSha256.hex(SECRET, "203.0.113.50"))).isEqualTo(5);
        assertThat(count("SELECT count(*) FROM customer_reports WHERE source_ip_hash=?", HmacSha256.hex(SECRET, "203.0.113.51"))).isEqualTo(1);
    }

    @Test
    void oneMachineAcceptsAtMostSixtySubmissionsPerHour() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        // Invalid submissions from many sources fill the machine's hourly budget (counted before validation).
        for (int i = 0; i < 60; i++) assertThat(raw(token, Map.of("type", "NOPE"), "198.18.0." + (i + 1), null).getResponse().getStatus()).isEqualTo(400);
        assertThat(raw(token, withoutContact(report("OTHER", null, "x")), "198.18.1.1", null).getResponse().getStatus()).isEqualTo(429);
        String other = token(fixtures.machine(admin.token()));
        assertThat(raw(other, withoutContact(report("OTHER", null, "x")), "198.18.1.2", null).getResponse().getStatus()).isEqualTo(201);
        clock.advance(Duration.ofMinutes(61));
        assertThat(raw(token, withoutContact(report("OTHER", null, "x")), "198.18.1.3", null).getResponse().getStatus()).isEqualTo(201);
        // Form info: 30 / minute / source.
        for (int i = 0; i < 30; i++) publicJson(get("/api/v1/public/report-forms/" + other), 200);
        publicJson(get("/api/v1/public/report-forms/" + other), 429);
    }

    // ---- 9. verification and work orders ----

    @Test
    void everyVerdictOfTheOrderTable() throws Exception {
        PlacedOrder failed = failedOrder();
        assertThat(verdictOf(failed)).isEqualTo("REFUND_ELIGIBLE");
        PlacedOrder paid = paidOrder();
        assertThat(verdictOf(paid)).isEqualTo("DISPENSE_PENDING");
        dispense.handleMachineEvent(machineCode(paid), DispenseService.EVENT_ACCEPTED, commandCode(paid));
        assertThat(verdictOf(paid)).isEqualTo("DISPENSE_PENDING");
        assertThat(verdictOf(completedOrder())).isEqualTo("DELIVERED_PER_MACHINE");
        PlacedOrder refunded = failedOrder();
        fixtures.api("POST", "/api/v1/payments/" + paymentId(referenceOf(refunded.orderId())) + "/refund",
                Map.of("reason", "DISPENSE_FAILED", "transferReference", "FT-VERDICT-" + refunded.orderId().toString().substring(0, 8)), admin.token(), 200);
        assertThat(verdictOf(refunded)).isEqualTo("ALREADY_REFUNDED");
        PlacedOrder pending = placeOrder();
        pay(pending, 201);
        assertThat(verdictOf(pending)).isEqualTo("NOT_PAID");
        PlacedOrder cancelled = placeOrder();
        kioskJson("POST", cancelled.order() + "/cancel", cancelled.shop().key(), null, 200);
        assertThat(verdictOf(cancelled)).isEqualTo("NOT_PAID");
        PlacedOrder late = placeOrder();
        pay(late, 201);
        kioskJson("POST", late.order() + "/cancel", late.shop().key(), null, 200);
        paid(referenceOf(late.orderId()), "TXN-LATE-" + late.orderId(), orderTotal(late.orderId()));
        assertThat(verdictOf(late)).isEqualTo("REFUND_ELIGIBLE");
        String machineFault = submit(token(failed), withoutContact(report("MACHINE_FAULT", failed.orderCode(), "x")), 201).path("data").path("reportCode").asText();
        assertThat(column(machineFault, "verdict")).isEqualTo("NOT_APPLICABLE");
        assertThat(column(machineFault, "order_id")).isNull();
    }

    @Test
    void anOrderOfAnotherMachineOrOlderThanSevenDaysIsNotFound() throws Exception {
        PlacedOrder order = failedOrder();
        String elsewhere = token(fixtures.machine(admin.token()));
        String code = submit(elsewhere, report("PAID_NOT_RECEIVED", order.orderCode(), null), 201).path("data").path("reportCode").asText();
        assertThat(column(code, "verdict")).isEqualTo("ORDER_NOT_FOUND");
        assertThat(column(code, "order_id")).isNull();
        PlacedOrder old = placeOrder();
        jdbc.update("UPDATE orders SET created_at = created_at - interval '9 days' WHERE id=?", old.orderId());
        assertThat(verdictOf(old)).isEqualTo("ORDER_NOT_FOUND");
    }

    @Test
    void aQualityReportOfACompletedOrderLinksTheSoldBatch() throws Exception {
        PlacedOrder order = completedOrder();
        String code = submit(token(order), report("PRODUCT_QUALITY", order.orderCode(), "Táo bị dập"), 201).path("data").path("reportCode").asText();
        UUID batch = jdbc.queryForObject("SELECT i.batch_id FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id"
                + " JOIN inventory_items i ON i.id=a.inventory_item_id WHERE oi.order_id=?", UUID.class, order.orderId());
        assertThat(column(code, "batch_id")).isEqualTo(batch);
        assertThat(column(code, "verdict")).isEqualTo("DELIVERED_PER_MACHINE");
        JsonNode detail = fixtures.api("GET", "/api/v1/customer-reports/" + reportId(code), null, admin.token(), 200);
        assertThat(detail.path("batch").path("id").asText()).isEqualTo(batch.toString());
        assertThat(detail.path("order").path("status").asText()).isEqualTo("COMPLETED");
    }

    @Test
    void reportsCreateOrJoinAnIncidentWorkOrderAndAdminsAreNotifiedOnce(CapturedOutput output) throws Exception {
        PlacedOrder order = failedOrder();
        Instant before = clock.instant();
        String first = submit(token(order), report("PAID_NOT_RECEIVED", order.orderCode(), "Đã chuyển khoản nhưng máy không ra hàng"), 201)
                .path("data").path("reportCode").asText();
        UUID workOrder = (UUID) column(first, "work_order_id");
        Map<String, Object> wo = jdbc.queryForMap("SELECT * FROM work_orders WHERE id=?", workOrder);
        assertThat(wo.get("type")).isEqualTo("INCIDENT");
        assertThat(wo.get("source")).isEqualTo("CUSTOMER_REPORT");
        assertThat(wo.get("priority")).isEqualTo("HIGH");
        assertThat(wo.get("status")).isEqualTo("OPEN");
        assertThat((String) wo.get("title")).startsWith("[" + first + "]");
        Instant due = ((java.sql.Timestamp) wo.get("due_at")).toInstant();
        assertThat(Duration.between(before.plus(Duration.ofHours(24)), due).abs()).isLessThan(Duration.ofMinutes(1));
        assertThat(column(first, "status")).isEqualTo("NEW");
        assertThat(notifications(first)).isEqualTo(1);

        String second = submit(token(order), report("PAID_NOT_RECEIVED", order.orderCode(), null), 201).path("data").path("reportCode").asText();
        assertThat(column(second, "work_order_id")).isEqualTo(workOrder);
        assertThat(column(second, "status")).isEqualTo("IN_REVIEW");
        assertThat(notifications(second)).isZero();
        assertThat(notifications(first)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM work_order_events WHERE work_order_id=? AND type='NOTE' AND note LIKE ?", workOrder, "%" + second + "%")).isEqualTo(1);

        // Priorities of the other types.
        String token = token(fixtures.machine(admin.token()));
        assertThat(priority(submit(token, report("PRODUCT_QUALITY", null, "x"), 201))).isEqualTo("NORMAL");
        // (an OTHER report on the same machine would join that open work order, so it gets its own machine)
        assertThat(priority(submit(token(fixtures.machine(admin.token())), withoutContact(report("OTHER", null, "x")), 201))).isEqualTo("LOW");

        // No contact data in work orders, events, notifications or logs.
        assertThat(jdbc.queryForList("SELECT title, description FROM work_orders").toString()).doesNotContain(PHONE, EMAIL, "An Nguyen");
        assertThat(jdbc.queryForList("SELECT note, details::text FROM work_order_events").toString()).doesNotContain(PHONE, EMAIL, "An Nguyen");
        assertThat(jdbc.queryForList("SELECT title, message FROM notifications").toString()).doesNotContain(PHONE, EMAIL, "An Nguyen");
        assertThat(output.getAll()).doesNotContain(PHONE, EMAIL, "An Nguyen");
    }

    @Test
    void machineFaultsJoinTheOpenCustomerReportWorkOrderOfTheMachine() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String token = token(machine);
        String first = submit(token, withoutContact(report("MACHINE_FAULT", null, "Màn hình tối")), 201).path("data").path("reportCode").asText();
        UUID workOrder = (UUID) column(first, "work_order_id");
        String second = submit(token, withoutContact(report("MACHINE_FAULT", null, "Không nhận tiền")), 201).path("data").path("reportCode").asText();
        String third = submit(token, withoutContact(report("OTHER", null, "Bẩn")), 201).path("data").path("reportCode").asText();
        assertThat(column(second, "work_order_id")).isEqualTo(workOrder);
        assertThat(column(third, "work_order_id")).isEqualTo(workOrder);
        assertThat(count("SELECT count(*) FROM work_order_events WHERE work_order_id=? AND type='NOTE' AND note=?", workOrder, "New customer report " + second)).isEqualTo(1);
        assertThat(notifications(second)).isZero();
        assertThat(count("SELECT count(*) FROM work_orders WHERE machine_id=?", machine)).isEqualTo(1);
        // Work order detail lists the linked reports.
        JsonNode detail = fixtures.api("GET", "/api/v1/work-orders/" + workOrder, null, admin.token(), 200);
        assertThat(detail.path("linkedReports")).hasSize(3);
        assertThat(detail.path("linkedReports").get(0).path("code").asText()).isEqualTo(first);
        assertThat(detail.path("linkedReports").toString()).doesNotContain("contact");
        // Once the work order is cancelled, the next fault opens a new one.
        fixtures.api("POST", "/api/v1/work-orders/" + workOrder + "/cancel", Map.of("reason", "Đã xử lý", "version",
                jdbc.queryForObject("SELECT version FROM work_orders WHERE id=?", Long.class, workOrder)), admin.token(), 200);
        String fourth = submit(token, withoutContact(report("MACHINE_FAULT", null, "Lại hỏng")), 201).path("data").path("reportCode").asText();
        assertThat(column(fourth, "work_order_id")).isNotEqualTo(workOrder);
    }

    // ---- 10. refund link ----

    @Test
    void refundEligibleReportsAreRefundCandidatesAndCloseWhenRefunded() throws Exception {
        PlacedOrder failed = failedOrder();
        String code = submit(token(failed), report("PAID_NOT_RECEIVED", failed.orderCode(), null), 201).path("data").path("reportCode").asText();
        PlacedOrder delivered = completedOrder();
        String quality = submit(token(delivered), report("PRODUCT_QUALITY", delivered.orderCode(), "Dập"), 201).path("data").path("reportCode").asText();
        UUID failedPayment = paymentId(referenceOf(failed.orderId())), deliveredPayment = paymentId(referenceOf(delivered.orderId()));

        JsonNode candidates = fixtures.api("GET", "/api/v1/refunds/candidates?type=CUSTOMER_REPORT&size=100", null, admin.token(), 200);
        Map<String, JsonNode> byPayment = new HashMap<>();
        candidates.path("content").forEach(item -> byPayment.put(item.path("paymentId").asText(), item));
        assertThat(byPayment).containsKeys(failedPayment.toString(), deliveredPayment.toString());
        JsonNode item = byPayment.get(failedPayment.toString());
        assertThat(item.path("type").asText()).isEqualTo("CUSTOMER_REPORT");
        assertThat(item.path("customerReport").path("reportCode").asText()).isEqualTo(code);
        assertThat(item.path("customerReport").path("contactPhone").asText()).isEqualTo("090****567");
        assertThat(item.path("relatedWorkOrder").path("id").asText()).isEqualTo(column(code, "work_order_id").toString());
        assertThat(byPayment.get(deliveredPayment.toString()).path("customerReport").path("reportCode").asText()).isEqualTo(quality);
        // In the unfiltered list a failed dispense keeps its own type and carries the report.
        JsonNode all = fixtures.api("GET", "/api/v1/refunds/candidates?size=100&machineId=" + failed.shop().machineId(), null, admin.token(), 200);
        assertThat(all.path("content").get(0).path("type").asText()).isEqualTo("DISPENSE_FAILED");
        assertThat(all.path("content").get(0).path("customerReport").path("reportCode").asText()).isEqualTo(code);
        assertThat(fixtures.api("GET", "/api/v1/refunds/candidates?size=100&machineId=" + delivered.shop().machineId(), null, admin.token(), 200)
                .path("content").get(0).path("type").asText()).isEqualTo("CUSTOMER_REPORT");

        fixtures.api("POST", "/api/v1/payments/" + failedPayment + "/refund", Map.of("reason", "DISPENSE_FAILED", "transferReference", "FT-RPT-1"), admin.token(), 200);
        assertThat(column(code, "status")).isEqualTo("RESOLVED");
        assertThat(column(code, "resolution")).isEqualTo("REFUNDED");
        assertThat(column(code, "resolved_by")).isEqualTo(admin.id());
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='CUSTOMER_REPORT_RESOLVED' AND entity_id=?", reportId(code))).isEqualTo(1);
        JsonNode after = fixtures.api("GET", "/api/v1/refunds/candidates?type=CUSTOMER_REPORT&size=100", null, admin.token(), 200);
        List<String> ids = new ArrayList<>();
        after.path("content").forEach(c -> ids.add(c.path("paymentId").asText()));
        assertThat(ids).doesNotContain(failedPayment.toString()).contains(deliveredPayment.toString());
        // Rejecting the quality report removes it from the candidates.
        fixtures.api("POST", "/api/v1/customer-reports/" + reportId(quality) + "/reject", Map.of("resolution", "SPAM"), admin.token(), 200);
        ids.clear();
        fixtures.api("GET", "/api/v1/refunds/candidates?type=CUSTOMER_REPORT&size=100", null, admin.token(), 200).path("content")
                .forEach(c -> ids.add(c.path("paymentId").asText()));
        assertThat(ids).doesNotContain(deliveredPayment.toString());
    }

    // ---- 11. admin ----

    @Test
    void adminListFiltersMasksAndShowsFullContactInDetail() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String token = token(machine);
        String quality = submit(token, report("PRODUCT_QUALITY", null, "Dập"), 201).path("data").path("reportCode").asText();
        String fault = submit(token, withoutContact(report("MACHINE_FAULT", null, "Hỏng")), 201).path("data").path("reportCode").asText();
        JsonNode page = fixtures.api("GET", "/api/v1/customer-reports?machineId=" + machine, null, admin.token(), 200);
        assertThat(page.path("totalElements").asLong()).isEqualTo(2);
        assertThat(page.path("content").get(0).path("code").asText()).isEqualTo(fault);
        JsonNode masked = page.path("content").get(1).path("contact");
        assertThat(masked.path("phone").asText()).isEqualTo("090****567");
        assertThat(masked.path("email").asText()).isEqualTo("a***@example.com");
        assertThat(masked.path("masked").asBoolean()).isTrue();
        assertThat(page.toString()).doesNotContain(PHONE, EMAIL);
        assertThat(codes(fixtures.api("GET", "/api/v1/customer-reports?machineId=" + machine + "&type=MACHINE_FAULT", null, admin.token(), 200))).containsExactly(fault);
        assertThat(codes(fixtures.api("GET", "/api/v1/customer-reports?machineId=" + machine + "&status=NEW&verdict=NOT_APPLICABLE&hasOrder=false", null, admin.token(), 200)))
                .containsExactlyInAnyOrder(fault, quality);
        assertThat(codes(fixtures.api("GET", "/api/v1/customer-reports?machineId=" + machine + "&hasOrder=true", null, admin.token(), 200))).isEmpty();
        java.time.LocalDate today = java.time.LocalDate.ofInstant(clock.instant(), java.time.ZoneId.of("Asia/Ho_Chi_Minh"));
        assertThat(codes(fixtures.api("GET", "/api/v1/customer-reports?machineId=" + machine + "&from=" + today + "&to=" + today, null, admin.token(), 200))).hasSize(2);
        assertThat(codes(fixtures.api("GET", "/api/v1/customer-reports?machineId=" + machine + "&from=" + today.plusDays(1), null, admin.token(), 200))).isEmpty();
        fixtures.response("GET", "/api/v1/customer-reports?status=NOPE", null, admin.token(), 400);

        JsonNode detail = fixtures.api("GET", "/api/v1/customer-reports/" + reportId(quality), null, admin.token(), 200);
        assertThat(detail.path("contact").path("phone").asText()).isEqualTo(PHONE);
        assertThat(detail.path("contact").path("email").asText()).isEqualTo(EMAIL);
        assertThat(detail.path("contact").path("masked").asBoolean()).isFalse();
        assertThat(detail.path("workOrder").path("code").asText()).startsWith("WO-");
    }

    @Test
    void staffSeesOnlyReportsOfTheirWorkOrdersWithMaskedContact() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        String mine = submit(token, report("PRODUCT_QUALITY", null, "Dập"), 201).path("data").path("reportCode").asText();
        String other = submit(token(fixtures.machine(admin.token())), report("PRODUCT_QUALITY", null, "Thối"), 201).path("data").path("reportCode").asText();
        UUID workOrder = (UUID) column(mine, "work_order_id");
        fixtures.api("POST", "/api/v1/work-orders/" + workOrder + "/assign", Map.of("assigneeId", staff.id(), "version",
                jdbc.queryForObject("SELECT version FROM work_orders WHERE id=?", Long.class, workOrder)), admin.token(), 200);

        JsonNode list = fixtures.api("GET", "/api/v1/customer-reports?size=100", null, staff.token(), 200);
        assertThat(codes(list)).containsExactly(mine);
        JsonNode detail = fixtures.api("GET", "/api/v1/customer-reports/" + reportId(mine), null, staff.token(), 200);
        assertThat(detail.path("contact").path("phone").asText()).isEqualTo("090****567");
        assertThat(detail.path("contact").path("masked").asBoolean()).isTrue();
        assertThat(detail.toString()).doesNotContain(PHONE, EMAIL);
        fixtures.response("GET", "/api/v1/customer-reports/" + reportId(other), null, staff.token(), 404);
        fixtures.response("POST", "/api/v1/customer-reports/" + reportId(mine) + "/review", null, staff.token(), 403);
        fixtures.response("POST", "/api/v1/machines/" + UUID.randomUUID() + "/report-token/rotate", null, staff.token(), 403);
    }

    @Test
    void reviewResolveAndRejectAreFinalAndAudited() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        String first = submit(token, report("PRODUCT_QUALITY", null, "Dập"), 201).path("data").path("reportCode").asText();
        UUID id = reportId(first);
        JsonNode reviewed = fixtures.api("POST", "/api/v1/customer-reports/" + id + "/review", null, admin.token(), 200);
        assertThat(reviewed.path("status").asText()).isEqualTo("IN_REVIEW");
        assertThat(fixtures.response("POST", "/api/v1/customer-reports/" + id + "/review", null, admin.token(), 409).path("message").asText()).startsWith("REPORT_NOT_NEW");
        fixtures.response("POST", "/api/v1/customer-reports/" + id + "/resolve", Map.of("resolution", "SPAM"), admin.token(), 400);
        fixtures.response("POST", "/api/v1/customer-reports/" + id + "/resolve", Map.of("resolution", "FIXED", "extra", 1), admin.token(), 400);
        JsonNode resolved = fixtures.api("POST", "/api/v1/customer-reports/" + id + "/resolve", Map.of("resolution", "FIXED", "note", "Đã đổi hàng"), admin.token(), 200);
        assertThat(resolved.path("status").asText()).isEqualTo("RESOLVED");
        assertThat(resolved.path("resolution").asText()).isEqualTo("FIXED");
        assertThat(resolved.path("resolvedBy").path("id").asText()).isEqualTo(admin.id().toString());
        assertThat(resolved.path("resolutionNote").asText()).isEqualTo("Đã đổi hàng");
        for (String action : List.of("review", "resolve", "reject")) {
            Object body = action.equals("review") ? null : Map.of("resolution", action.equals("resolve") ? "FIXED" : "SPAM");
            assertThat(fixtures.response("POST", "/api/v1/customer-reports/" + id + "/" + action, body, admin.token(), 409).path("message").asText())
                    .startsWith(action.equals("review") ? "REPORT_ALREADY_CLOSED" : "REPORT_ALREADY_CLOSED");
        }
        String second = submit(token, withoutContact(report("OTHER", null, "Spam")), 201).path("data").path("reportCode").asText();
        fixtures.response("POST", "/api/v1/customer-reports/" + reportId(second) + "/reject", Map.of("resolution", "FIXED"), admin.token(), 400);
        JsonNode rejected = fixtures.api("POST", "/api/v1/customer-reports/" + reportId(second) + "/reject", Map.of("resolution", "DUPLICATE"), admin.token(), 200);
        assertThat(rejected.path("status").asText()).isEqualTo("REJECTED");
        fixtures.response("POST", "/api/v1/customer-reports/" + UUID.randomUUID() + "/review", null, admin.token(), 404);

        assertThat(count("SELECT count(*) FROM audit_logs WHERE entity_type='CustomerReport' AND entity_id=? AND user_id=?", id, admin.id())).isEqualTo(2);
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='CUSTOMER_REPORT_REVIEWED' AND entity_id=?", id)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='CUSTOMER_REPORT_RESOLVED' AND entity_id=?", id)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='CUSTOMER_REPORT_REJECTED' AND entity_id=?", reportId(second))).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT old_value::text, new_value::text FROM audit_logs WHERE entity_type='CustomerReport'").toString()).doesNotContain(PHONE, EMAIL);
    }

    @Test
    void photosAreServedWithSafeHeadersAndTheReportsVisibility() throws Exception {
        String token = token(fixtures.machine(admin.token()));
        byte[] png = image("png", 20, 20);
        String code = submitWithPhotos(token, withoutContact(report("MACHINE_FAULT", null, "Kẹt")), 201,
                new MockMultipartFile("photos", "a.png", "image/png", png)).path("data").path("reportCode").asText();
        UUID id = reportId(code);
        JsonNode detail = fixtures.api("GET", "/api/v1/customer-reports/" + id, null, admin.token(), 200);
        String photoId = detail.path("photos").get(0).path("id").asText();
        var response = mvc.perform(get("/api/v1/customer-reports/" + id + "/photos/" + photoId).header("Authorization", "Bearer " + admin.token()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentType()).isEqualTo("image/png");
        assertThat(response.getHeader("Content-Disposition")).isEqualTo("inline");
        assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(response.getHeader("Cache-Control")).contains("no-store").contains("private");
        assertThat(ImageIO.read(new java.io.ByteArrayInputStream(response.getContentAsByteArray())).getWidth()).isEqualTo(20);
        assertThat(mvc.perform(get("/api/v1/customer-reports/" + id + "/photos/" + photoId).header("Authorization", "Bearer " + staff.token()))
                .andReturn().getResponse().getStatus()).isEqualTo(404);
        assertThat(mvc.perform(get("/api/v1/customer-reports/" + id + "/photos/" + UUID.randomUUID()).header("Authorization", "Bearer " + admin.token()))
                .andReturn().getResponse().getStatus()).isEqualTo(404);
    }

    @Test
    void theKioskLinkUsesTheCurrentTokenAndOnlyItsOwnOrders() throws Exception {
        PlacedOrder order = failedOrder();
        String key = order.shop().key();
        JsonNode link = kioskData("GET", "/api/v1/kiosk/incident-report-link?orderCode=" + order.orderCode().toLowerCase(), key, null, 200);
        assertThat(link.path("url").asText()).isEqualTo("https://report.test.invalid/report/" + token(order) + "?order=" + order.orderCode());
        PlacedOrder foreign = placeOrder();
        assertThat(kioskData("GET", "/api/v1/kiosk/incident-report-link?orderCode=" + foreign.orderCode(), key, null, 200).path("url").asText())
                .isEqualTo("https://report.test.invalid/report/" + token(order));
        assertThat(kioskData("GET", "/api/v1/kiosk/incident-report-link", key, null, 200).path("url").asText()).doesNotContain("?");
        String old = token(order);
        JsonNode rotated = fixtures.api("POST", "/api/v1/machines/" + order.shop().machineId() + "/report-token/rotate", null, admin.token(), 200);
        String fresh = token(order);
        assertThat(fresh).isNotEqualTo(old).matches("^[A-Za-z0-9_-]{22}$");
        assertThat(rotated.path("url").asText()).isEqualTo("https://report.test.invalid/report/" + fresh);
        assertThat(kioskData("GET", "/api/v1/kiosk/incident-report-link", key, null, 200).path("url").asText()).endsWith("/" + fresh);
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='MACHINE_REPORT_TOKEN_ROTATED' AND entity_id=?", order.shop().machineId())).isEqualTo(1);
        submit(old, withoutContact(report("OTHER", null, "x")), 404);
        submit(fresh, withoutContact(report("OTHER", null, "x")), 201);
        fixtures.response("GET", "/api/v1/kiosk/incident-report-link", null, admin.token(), 403);
    }

    // ---- helpers ----

    private Map<String, Object> report(String type, String orderCode, String description) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", type);
        body.put("orderCode", orderCode);
        body.put("description", description);
        body.put("contactName", "An Nguyen");
        body.put("contactPhone", PHONE);
        body.put("contactEmail", EMAIL);
        body.put("consent", true);
        body.put("website", "");
        return body;
    }

    private static Map<String, Object> withoutContact(Map<String, Object> body) {
        body.put("contactName", null);
        body.put("contactPhone", null);
        body.put("contactEmail", null);
        return body;
    }

    private JsonNode submit(String token, Map<String, Object> body) throws Exception {
        return submit(token, body, 201);
    }

    private JsonNode submit(String token, Map<String, Object> body, int expected) throws Exception {
        return submitWithPhotos(token, body, expected);
    }

    private JsonNode submitWithPhotos(String token, Map<String, Object> body, int expected, MockMultipartFile... photos) throws Exception {
        var builder = multipart("/api/v1/public/report-forms/" + token + "/reports");
        builder.file(new MockMultipartFile("report", "", "application/json", json.writeValueAsBytes(body)));
        for (var photo : photos) builder.file(photo);
        return perform(builder, expected);
    }

    private JsonNode perform(MockMultipartHttpServletRequestBuilder builder, int expected) throws Exception {
        builder.with(r -> { r.setRemoteAddr(ip); return r; });
        var response = mvc.perform(builder).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expected);
        return json.readTree(response.getContentAsString());
    }

    private MvcResult raw(String token, Map<String, Object> body, String remote, String forwarded) throws Exception {
        var builder = multipart("/api/v1/public/report-forms/" + token + "/reports");
        builder.file(new MockMultipartFile("report", "", "application/json", json.writeValueAsBytes(body)));
        builder.with(r -> { r.setRemoteAddr(remote); return r; });
        if (forwarded != null) builder.header("X-Forwarded-For", forwarded);
        return mvc.perform(builder).andReturn();
    }

    private JsonNode publicJson(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder builder, int expected) throws Exception {
        builder.with(r -> { r.setRemoteAddr(ip); return r; });
        var response = mvc.perform(builder).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expected);
        return json.readTree(response.getContentAsString());
    }

    private String verdictOf(PlacedOrder order) throws Exception {
        String code = submit(token(order), report("PAID_NOT_RECEIVED", order.orderCode(), null), 201).path("data").path("reportCode").asText();
        limiter.reset();
        return (String) column(code, "verdict");
    }

    private Object column(String reportCode, String column) {
        return jdbc.queryForMap("SELECT " + column + " AS v FROM customer_reports WHERE code=?", reportCode).get("v");
    }

    private UUID reportId(String code) {
        return jdbc.queryForObject("SELECT id FROM customer_reports WHERE code=?", UUID.class, code);
    }

    private String priority(JsonNode submitted) {
        return jdbc.queryForObject("SELECT w.priority FROM work_orders w JOIN customer_reports r ON r.work_order_id=w.id WHERE r.code=?", String.class,
                submitted.path("data").path("reportCode").asText());
    }

    private long notifications(String reportCode) {
        return count("SELECT count(*) FROM notifications WHERE user_id=? AND (title LIKE ? OR message LIKE ?)", admin.id(), "%" + reportCode + "%",
                "%" + reportCode + "%");
    }

    private static List<String> codes(JsonNode page) {
        List<String> codes = new ArrayList<>();
        page.path("content").forEach(item -> codes.add(item.path("code").asText()));
        return codes;
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(name -> { if (!name.equals("timestamp")) names.add(name); });
        return names;
    }

    private String token(UUID machineId) {
        return jdbc.queryForObject("SELECT report_token FROM machines WHERE id=?", String.class, machineId);
    }

    private String token(PlacedOrder order) {
        return token(order.shop().machineId());
    }

    private String code(UUID machineId) {
        return jdbc.queryForObject("SELECT code FROM machines WHERE id=?", String.class, machineId);
    }

    private static byte[] image(String format, int width, int height) throws Exception {
        var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < width; x++) for (int y = 0; y < height; y++) image.setRGB(x, y, (x * 7 + y * 13) & 0xFFFFFF);
        var out = new ByteArrayOutputStream();
        ImageIO.write(image, format, out);
        return out.toByteArray();
    }

    /** Inserts an APP1 Exif segment carrying a fake GPS marker right after SOI. */
    private static byte[] withExif(byte[] jpeg) {
        byte[] payload = ("Exif\0\0MM\0*\0\0\0\bGPS-SECRET-LOCATION").getBytes(StandardCharsets.ISO_8859_1);
        int length = payload.length + 2;
        var out = new ByteArrayOutputStream();
        out.write(jpeg, 0, 2);
        out.write(0xFF);
        out.write(0xE1);
        out.write(length >> 8);
        out.write(length & 0xFF);
        out.write(payload, 0, payload.length);
        out.write(jpeg, 2, jpeg.length - 2);
        return out.toByteArray();
    }

    private PlacedOrder paidOrder() throws Exception {
        PlacedOrder order = placeOrder();
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        return order;
    }

    private PlacedOrder failedOrder() throws Exception {
        PlacedOrder order = paidOrder();
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ABORTED, commandCode(order));
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
        return order;
    }

    private PlacedOrder completedOrder() throws Exception {
        PlacedOrder order = paidOrder();
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ACCEPTED, commandCode(order));
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, commandCode(order));
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        return order;
    }

    private String machineCode(PlacedOrder order) {
        return code(order.shop().machineId());
    }

    private String commandCode(PlacedOrder order) {
        return jdbc.queryForObject("SELECT command_code FROM dispense_commands WHERE order_id=?", String.class, order.orderId());
    }

    /** A transport that accepts every command, so dispense commands are SENT and machine reports apply. */
    @TestConfiguration(proxyBeanMethods = false)
    static class ConnectedTransport {
        @Bean
        @Primary
        MachineCommandGateway connectedCommandGateway() {
            return (machineCode, commandCode, columnCode) -> true;
        }
    }
}
