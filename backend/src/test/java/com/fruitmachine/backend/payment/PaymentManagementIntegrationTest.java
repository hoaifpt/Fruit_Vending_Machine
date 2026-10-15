package com.fruitmachine.backend.payment;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractPaymentIntegrationTest;
import com.fruitmachine.backend.support.ControllableGateway.Mode;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PaymentManagementIntegrationTest extends AbstractPaymentIntegrationTest {
    @Test
    void adminListsFiltersPagesAndSortsPaymentsWithoutQrCodes() throws Exception {
        var order = placeOrder(2);
        var other = placeOrder(1);
        Instant start = Instant.now().minusSeconds(5);
        gateway.mode(Mode.FAIL);
        pay(order, 502);
        gateway.mode(Mode.SUCCESS);
        var live = pay(order, 201).path("data");
        pay(other, 201);

        var page = fixtures.api("GET", "/api/v1/payments?orderId=" + order.orderId() + "&size=1&page=0", null, admin.token(), 200);
        assertThat(page.path("totalElements").asInt()).isEqualTo(2);
        assertThat(page.path("totalPages").asInt()).isEqualTo(2);
        assertThat(page.path("content")).hasSize(1);
        // Newest first by default.
        assertThat(page.path("content").get(0).path("id").asText()).isEqualTo(live.path("paymentId").asText());
        var item = page.path("content").get(0);
        assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "orderId", "orderCode", "machineCode", "provider", "status",
                "amount", "paymentReference", "transactionId", "createdAt", "paidAt", "expiredAt");
        assertThat(item.path("orderCode").asText()).isEqualTo(order.orderCode());
        assertThat(item.path("paymentReference").asText()).startsWith("TEST-");
        assertThat(item.path("transactionId").isNull()).isTrue();
        assertThat(page.toString()).doesNotContain("qrCode", "TEST-QR");

        assertThat(fixtures.api("GET", "/api/v1/payments?orderId=" + order.orderId() + "&status=FAILED", null, admin.token(), 200).path("totalElements").asInt()).isEqualTo(1);
        assertThat(fixtures.api("GET", "/api/v1/payments?orderId=" + order.orderId() + "&status=PENDING", null, admin.token(), 200).path("totalElements").asInt()).isEqualTo(1);
        assertThat(fixtures.api("GET", "/api/v1/payments?provider=testpay&machineId=" + order.shop().machineId(), null, admin.token(), 200).path("totalElements").asInt()).isEqualTo(2);
        assertThat(fixtures.api("GET", "/api/v1/payments?provider=MOCK&machineId=" + order.shop().machineId(), null, admin.token(), 200).path("totalElements").asInt()).isZero();
        assertThat(fixtures.api("GET", "/api/v1/payments?machineId=" + other.shop().machineId(), null, admin.token(), 200).path("totalElements").asInt()).isEqualTo(1);
        assertThat(fixtures.api("GET", "/api/v1/payments?machineId=" + order.shop().machineId() + "&createdFrom=" + start + "&createdTo=" + Instant.now().plusSeconds(60), null, admin.token(), 200).path("totalElements").asInt()).isEqualTo(2);
        assertThat(fixtures.api("GET", "/api/v1/payments?machineId=" + order.shop().machineId() + "&createdTo=" + start, null, admin.token(), 200).path("totalElements").asInt()).isZero();
        var byAmount = fixtures.api("GET", "/api/v1/payments?machineId=" + other.shop().machineId() + "&sort=amount,asc", null, admin.token(), 200);
        assertThat(byAmount.path("content")).hasSize(1);
        assertThat(fixtures.api("GET", "/api/v1/payments?sort=paidAt,desc&size=5", null, admin.token(), 200).path("content")).isNotNull();
        for (String bad : new String[]{"size=0", "size=101", "page=-1", "sort=qrCode,asc", "sort=amount,sideways", "status=SETTLED", "orderId=nope", "createdFrom=yesterday"})
            fixtures.response("GET", "/api/v1/payments?" + bad, null, admin.token(), 400);
    }

    @Test
    void adminViewsPaymentDetailsIncludingTheQrCode() throws Exception {
        var order = placeOrder(1);
        var created = pay(order, 201).path("data");
        var detail = fixtures.api("GET", "/api/v1/payments/" + created.path("paymentId").asText(), null, admin.token(), 200);
        assertThat(detail.path("qrCode").asText()).isEqualTo(created.path("qrCode").asText());
        assertThat(detail.path("amount").decimalValue()).isEqualByComparingTo("35000");
        assertThat(detail.path("orderId").asText()).isEqualTo(order.orderId().toString());
        assertThat(detail.path("machineCode").asText()).isNotBlank();
        fixtures.response("GET", "/api/v1/payments/" + UUID.randomUUID(), null, admin.token(), 404);
        fixtures.response("GET", "/api/v1/payments/not-a-uuid", null, admin.token(), 400);
    }

    @Test
    void onlyAdminMayUsePaymentsApiAndNoWriteOrStatusOperationExists() throws Exception {
        var order = placeOrder(1);
        var created = pay(order, 201).path("data");
        String id = created.path("paymentId").asText();
        for (String path : new String[]{"/api/v1/payments", "/api/v1/payments/" + id}) {
            fixtures.response("GET", path, null, staff.token(), 403);
            fixtures.response("GET", path, null, null, 401);
            assertThat(kioskCall("GET", path, order.shop().key(), null).getResponse().getStatus()).isEqualTo(401);
        }
        fixtures.response("GET", "/api/v1/kiosk/me", null, admin.token(), 403);
        for (String method : new String[]{"POST", "PUT", "PATCH", "DELETE"}) {
            for (String path : new String[]{"/api/v1/payments", "/api/v1/payments/" + id, "/api/v1/payments/" + id + "/status", "/api/v1/payments/" + id + "/success"}) {
                int adminStatus = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .request(org.springframework.http.HttpMethod.valueOf(method), path).header("Authorization", "Bearer " + admin.token())
                        .contentType("application/json").content("{\"status\":\"SUCCESS\"}")).andReturn().getResponse().getStatus();
                // No handler exists for any write or status operation: 405 on existing paths, 404 elsewhere.
                assertThat(adminStatus).as("%s %s", method, path).isIn(404, 405);
                fixtures.response(method, path, java.util.Map.of("status", "SUCCESS"), staff.token(), 403);
            }
        }
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE id=?", String.class, UUID.fromString(id))).isEqualTo("PENDING");
    }

    @Test
    void orderDetailsListPaymentSummariesForAdminAndStaffWithoutSensitiveFields() throws Exception {
        var order = placeOrder(1);
        gateway.mode(Mode.FAIL);
        pay(order, 502);
        gateway.mode(Mode.SUCCESS);
        pay(order, 201);
        for (String token : new String[]{admin.token(), staff.token()}) {
            JsonNode detail = fixtures.api("GET", "/api/v1/orders/" + order.orderId(), null, token, 200);
            JsonNode payments = detail.path("payments");
            assertThat(payments).hasSize(2);
            assertThat(payments.get(0).path("status").asText()).isEqualTo("FAILED");
            assertThat(payments.get(1).path("status").asText()).isEqualTo("PENDING");
            assertThat(payments.get(0).fieldNames()).toIterable().containsExactlyInAnyOrder("id", "provider", "status", "amount", "createdAt", "paidAt", "expiredAt");
            assertThat(payments.toString()).doesNotContain("qrCode", "paymentReference", "transactionId", "TEST-QR");
        }
        var empty = placeOrder(1);
        assertThat(fixtures.api("GET", "/api/v1/orders/" + empty.orderId(), null, staff.token(), 200).path("payments")).isEmpty();
        clock.advance(Duration.ofMinutes(10));
        assertThat(expiry.sweep()).isGreaterThanOrEqualTo(1);
        var after = fixtures.api("GET", "/api/v1/orders/" + order.orderId(), null, admin.token(), 200).path("payments");
        assertThat(after.get(1).path("status").asText()).isEqualTo("EXPIRED");
    }
}
