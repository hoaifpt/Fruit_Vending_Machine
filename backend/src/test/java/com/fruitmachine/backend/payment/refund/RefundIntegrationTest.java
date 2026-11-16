package com.fruitmachine.backend.payment.refund;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.dispense.service.MachineCommandGateway;
import com.fruitmachine.backend.payment.refund.dto.RefundCandidateType;
import com.fruitmachine.backend.payment.refund.service.RefundQueryService;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import jakarta.persistence.EntityManagerFactory;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.AfterEach;
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
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** Issue #72: manual refunds, candidates, refund views, schema and access. */
@Import(RefundIntegrationTest.ConnectedTransport.class)
@ExtendWith(OutputCaptureExtension.class)
@TestPropertySource(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
class RefundIntegrationTest extends AbstractWebhookIntegrationTest {
    static final String PAYER_ACCOUNT = "0123456789012";

    @Autowired DispenseService dispense;
    @Autowired RefundQueryService queries;
    @Autowired BusinessCalendar calendar;
    @Autowired EntityManagerFactory entityManagerFactory;

    @AfterEach
    void clearSecurity() {
        SecurityContextHolder.clearContext();
    }

    // ---- 7. migration ----

    @Test
    void refundColumnsAreGuardedByTheSchema() throws Exception {
        PlacedOrder order = failedOrder();
        UUID payment = paymentOf(order);
        assertThatThrownBy(() -> jdbc.update("UPDATE payments SET status='REFUNDED' WHERE id=?", payment))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE payments SET status='REFUNDED', refunded_at=paid_at, refunded_by=?, refund_reason='OTHER',"
                + " refund_transfer_ref='FT-SCHEMA-1', refund_note='  ' WHERE id=?", admin.id(), payment)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE payments SET status='REFUNDED', refunded_at=paid_at, refunded_by=?, refund_reason='OTHER',"
                + " refund_transfer_ref='FT-SCHEMA-1' WHERE id=?", admin.id(), payment)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE payments SET status='REFUNDED', refunded_at=paid_at, refunded_by=?, refund_reason='DISPENSE_FAILED',"
                + " refund_transfer_ref='bad ref!' WHERE id=?", admin.id(), payment)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE payments SET status='REFUNDED', refunded_at=paid_at - interval '1 second', refunded_by=?,"
                + " refund_reason='DISPENSE_FAILED', refund_transfer_ref='FT-SCHEMA-1' WHERE id=?", admin.id(), payment)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET status='REFUNDED' WHERE id=?", order.orderId())).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET refunded_at=now() WHERE id=?", order.orderId())).isInstanceOf(DataIntegrityViolationException.class);

        refund(payment, "DISPENSE_FAILED", "FT-SCHEMA-1", null, 200);
        PlacedOrder other = failedOrder();
        assertThatThrownBy(() -> jdbc.update("UPDATE payments SET status='REFUNDED', refunded_at=paid_at, refunded_by=?, refund_reason='DISPENSE_FAILED',"
                + " refund_transfer_ref='FT-SCHEMA-1' WHERE id=?", admin.id(), paymentOf(other))).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(count("SELECT count(*) FROM pg_indexes WHERE indexname IN ('uq_payments_refund_transfer_ref', 'ix_payments_refunded_at')")).isEqualTo(2);
    }

    // ---- 8. recording ----

    @Test
    void aFailedDispenseRefundsPaymentAndOrderWithOneAuditRow() throws Exception {
        PlacedOrder order = failedOrder();
        UUID payment = paymentOf(order);
        UUID bowl = bowlOf(order.orderId());
        long transactions = count("SELECT count(*) FROM inventory_transactions");
        JsonNode body = refund(payment, "DISPENSE_FAILED", "  FT26317123456789 ", "Chuyen khoan lai qua Vietcombank", 200).path("data");

        assertThat(body.path("status").asText()).isEqualTo("REFUNDED");
        assertThat(body.path("refund").path("reason").asText()).isEqualTo("DISPENSE_FAILED");
        assertThat(body.path("refund").path("transferReference").asText()).isEqualTo("FT26317123456789");
        assertThat(body.path("refund").path("refundedBy").path("id").asText()).isEqualTo(admin.id().toString());
        assertThat(body.path("refund").path("refundedAt").isTextual()).isTrue();
        assertThat(orderStatus(order.orderId())).isEqualTo("REFUNDED");
        assertThat(count("SELECT count(*) FROM orders WHERE id=? AND refunded_at IS NOT NULL", order.orderId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT refund_note FROM payments WHERE id=?", String.class, payment)).isEqualTo("Chuyen khoan lai qua Vietcombank");
        // Refunds never touch inventory: the bowl stays blocked for the removal workflow.
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, bowl)).isEqualTo("DISPENSE_FAILED");
        assertThat(count("SELECT count(*) FROM inventory_transactions")).isEqualTo(transactions);

        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='PAYMENT_REFUNDED' AND entity_type='Payment' AND entity_id=? AND user_id=?"
                + " AND ip_address IS NOT NULL", payment, admin.id())).isEqualTo(1);
        JsonNode before = auditValue("PAYMENT_REFUNDED", payment, "old_value");
        JsonNode after = auditValue("PAYMENT_REFUNDED", payment, "new_value");
        assertThat(before.path("paymentStatus").asText()).isEqualTo("SUCCESS");
        assertThat(before.path("orderStatus").asText()).isEqualTo("DISPENSE_FAILED");
        assertThat(after.path("paymentStatus").asText()).isEqualTo("REFUNDED");
        assertThat(after.path("orderStatus").asText()).isEqualTo("REFUNDED");
        assertThat(after.path("transferReference").asText()).isEqualTo("FT26317123456789");
        assertThat(new BigDecimal(after.path("amount").asText())).isEqualByComparingTo("35000");
        assertThat(after.path("orderCode").asText()).isEqualTo(order.orderCode());

        // Payment and order detail carry the refund block.
        JsonNode detail = fixtures.api("GET", "/api/v1/payments/" + payment, null, admin.token(), 200);
        assertThat(detail.path("refund").path("transferReference").asText()).isEqualTo("FT26317123456789");
        JsonNode orderDetail = fixtures.api("GET", "/api/v1/orders/" + order.orderId(), null, admin.token(), 200);
        assertThat(orderDetail.path("refundedAt").isTextual()).isTrue();
        assertThat(orderDetail.path("refunds")).hasSize(1);
        assertThat(orderDetail.path("refunds").get(0).path("transferReference").asText()).isEqualTo("FT26317123456789");
        // STAFF reads orders but not payment data: no refund details.
        JsonNode staffDetail = fixtures.api("GET", "/api/v1/orders/" + order.orderId(), null, staff.token(), 200);
        assertThat(staffDetail.path("status").asText()).isEqualTo("REFUNDED");
        assertThat(staffDetail.path("refunds")).isEmpty();
        // A payment that is not refunded has no refund block.
        assertThat(fixtures.api("GET", "/api/v1/payments/" + paymentOf(failedOrder()), null, admin.token(), 200).path("refund").isNull()).isTrue();
    }

    @Test
    void aLatePaymentIsRefundedAndTheCancelledOrderStaysCancelled() throws Exception {
        PlacedOrder order = lateOrder();
        UUID payment = paymentOf(order);
        refund(payment, "DISPENSE_FAILED", "FT-LATE-0", null, 409);
        refund(payment, "LATE_PAYMENT", "FT-LATE-1", null, 200);
        assertThat(paymentStatus(referenceOf(order.orderId()))).isEqualTo("REFUNDED");
        assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
        assertThat(count("SELECT count(*) FROM orders WHERE id=? AND refunded_at IS NULL", order.orderId())).isEqualTo(1);
        assertThat(auditValue("PAYMENT_REFUNDED", payment, "new_value").path("orderStatus").asText()).isEqualTo("CANCELLED");
    }

    @Test
    void aDuplicatePaymentIsRefundedWithoutTouchingTheOrderButThePayingPaymentIsNoDuplicate() throws Exception {
        PlacedOrder order = completedOrder();
        UUID first = paymentOf(order);
        String second = insertPendingAttempt(order.orderId(), "TEST-DUP-" + order.orderId().toString().substring(0, 8), orderTotal(order.orderId()));
        assertThat(paid(second, "TXN-DUP-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        UUID duplicate = paymentId(second);

        assertThat(message(refund(first, "DUPLICATE_PAYMENT", "FT-DUP-0", null, 409))).startsWith("REFUND_REASON_MISMATCH");
        assertThat(message(refund(duplicate, "PRODUCT_QUALITY", "FT-DUP-0", null, 409))).startsWith("REFUND_REASON_MISMATCH");
        refund(duplicate, "DUPLICATE_PAYMENT", "FT-DUP-1", null, 200);
        assertThat(paymentStatus(second)).isEqualTo("REFUNDED");
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE id=?", String.class, first)).isEqualTo("SUCCESS");
        // The paying payment can still be refunded for the product.
        refund(first, "PRODUCT_QUALITY", "FT-DUP-2", "Khach phan anh trai cay hong", 200);
        assertThat(orderStatus(order.orderId())).isEqualTo("REFUNDED");
    }

    @Test
    void productQualityRefundsACompletedOrderAndTheBowlStaysSold() throws Exception {
        PlacedOrder order = completedOrder();
        UUID payment = paymentOf(order);
        UUID bowl = bowlOf(order.orderId());
        assertThat(message(refund(payment, "DISPENSE_FAILED", "FT-PQ-0", null, 409))).startsWith("REFUND_REASON_MISMATCH");
        assertThat(message(refund(payment, "LATE_PAYMENT", "FT-PQ-0", null, 409))).startsWith("REFUND_REASON_MISMATCH");
        refund(payment, "PRODUCT_QUALITY", "FT-PQ-1", null, 200);
        assertThat(orderStatus(order.orderId())).isEqualTo("REFUNDED");
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, bowl)).isEqualTo("SOLD");
    }

    @Test
    void otherNeedsANoteAndAFinishedOrder() throws Exception {
        PlacedOrder order = completedOrder();
        UUID payment = paymentOf(order);
        refund(payment, "OTHER", "FT-OTHER-1", null, 400);
        refund(payment, "OTHER", "FT-OTHER-1", "   ", 400);
        refund(payment, "OTHER", "FT-OTHER-1", "Quyet dinh cua quan ly", 200);
        assertThat(orderStatus(order.orderId())).isEqualTo("REFUNDED");
        assertThat(message(refund(paymentOf(lateOrder()), "OTHER", "FT-OTHER-2", "Ghi chu", 409))).startsWith("REFUND_REASON_MISMATCH");
    }

    @Test
    void unresolvedDispensingAndUnpaidPaymentsAreRefused() throws Exception {
        long refunded = count("SELECT count(*) FROM payments WHERE status='REFUNDED'");
        long audits = count("SELECT count(*) FROM audit_logs WHERE action='PAYMENT_REFUNDED'");
        PlacedOrder paidOnly = paidOrder();
        assertThat(message(refund(paymentOf(paidOnly), "DISPENSE_FAILED", "FT-WAIT-1", null, 409))).startsWith("DISPENSE_IN_PROGRESS");
        dispense.handleMachineEvent(machineCode(paidOnly), DispenseService.EVENT_ACCEPTED, commandCode(paidOnly));
        assertThat(orderStatus(paidOnly.orderId())).isEqualTo("DISPENSING");
        assertThat(message(refund(paymentOf(paidOnly), "DISPENSE_FAILED", "FT-WAIT-1", null, 409))).startsWith("DISPENSE_IN_PROGRESS");
        // A duplicate payment of a paid order also waits for the final dispense result.
        PlacedOrder paidTwice = paidOrder();
        String second = insertPendingAttempt(paidTwice.orderId(), "TEST-WAIT-" + paidTwice.orderId().toString().substring(0, 8), orderTotal(paidTwice.orderId()));
        paid(second, "TXN-WAIT-" + paidTwice.orderId(), orderTotal(paidTwice.orderId()));
        assertThat(message(refund(paymentId(second), "DUPLICATE_PAYMENT", "FT-WAIT-2", null, 409))).startsWith("DISPENSE_IN_PROGRESS");

        PlacedOrder pending = placeOrder();
        pay(pending, 201);
        assertThat(message(refund(paymentOf(pending), "DISPENSE_FAILED", "FT-WAIT-3", null, 409))).startsWith("PAYMENT_NOT_REFUNDABLE");
        for (String status : List.of("FAILED", "EXPIRED")) {
            PlacedOrder other = placeOrder();
            pay(other, 201);
            jdbc.update("UPDATE payments SET status=? WHERE order_id=?", status, other.orderId());
            assertThat(message(refund(paymentOf(other), "OTHER", "FT-WAIT-4", "x", 409))).startsWith("PAYMENT_NOT_REFUNDABLE");
        }
        refund(UUID.randomUUID(), "OTHER", "FT-WAIT-5", "x", 404);
        assertThat(count("SELECT count(*) FROM payments WHERE status='REFUNDED'")).isEqualTo(refunded);
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='PAYMENT_REFUNDED'")).isEqualTo(audits);
    }

    @Test
    void aSecondRefundAndAReusedTransferReferenceAreRefused() throws Exception {
        UUID payment = paymentOf(failedOrder());
        refund(payment, "DISPENSE_FAILED", "FT-ONCE-1", null, 200);
        assertThat(message(refund(payment, "DISPENSE_FAILED", "FT-ONCE-1", null, 409))).startsWith("PAYMENT_ALREADY_REFUNDED");
        assertThat(message(refund(payment, "OTHER", "FT-ONCE-2", "again", 409))).startsWith("PAYMENT_ALREADY_REFUNDED");
        UUID other = paymentOf(failedOrder());
        assertThat(message(refund(other, "DISPENSE_FAILED", "FT-ONCE-1", null, 409))).startsWith("REFUND_TRANSFER_REF_USED");
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='PAYMENT_REFUNDED' AND entity_id IN (?, ?)", payment, other)).isEqualTo(1);
    }

    @Test
    void invalidBodiesAreRejected() throws Exception {
        UUID payment = paymentOf(failedOrder());
        for (String reference : List.of("abc", "has space", "x".repeat(65), "FT#1234", "")) refund(payment, "DISPENSE_FAILED", reference, null, 400);
        var body = new HashMap<String, Object>(Map.of("reason", "DISPENSE_FAILED", "transferReference", "FT-BODY-1", "amount", 1));
        fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", body, admin.token(), 400);
        fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", Map.of("transferReference", "FT-BODY-1"), admin.token(), 400);
        fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", Map.of("reason", "SOMETHING", "transferReference", "FT-BODY-1"), admin.token(), 400);
        refund(payment, "DISPENSE_FAILED", "FT-BODY-1", "n".repeat(501), 400);
        assertThat(paymentStatus(jdbc.queryForObject("SELECT payment_reference FROM payments WHERE id=?", String.class, payment))).isEqualTo("SUCCESS");
    }

    @Test
    void concurrentRefundsOfOnePaymentOrOneTransferLetExactlyOneSucceed() throws Exception {
        UUID payment = paymentOf(failedOrder());
        List<Callable<Integer>> same = new ArrayList<>();
        for (int n = 0; n < 4; n++) {
            String reference = "FT-RACE-" + n;
            same.add(() -> refundStatus(payment, "DISPENSE_FAILED", reference));
        }
        assertThat(parallel(same)).containsOnly(200, 409).filteredOn(code -> code == 200).hasSize(1);
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='PAYMENT_REFUNDED' AND entity_id=?", payment)).isEqualTo(1);

        UUID first = paymentOf(failedOrder()), second = paymentOf(failedOrder());
        List<Integer> shared = parallel(List.<Callable<Integer>>of(() -> refundStatus(first, "DISPENSE_FAILED", "FT-RACE-SHARED"),
                () -> refundStatus(second, "DISPENSE_FAILED", "FT-RACE-SHARED")));
        assertThat(shared).containsExactlyInAnyOrder(200, 409);
        assertThat(count("SELECT count(*) FROM payments WHERE refund_transfer_ref='FT-RACE-SHARED'")).isEqualTo(1);
    }

    @Test
    void anIncidentWorkOrderReceivesANoteAndOtherWorkOrdersAreRejected() throws Exception {
        PlacedOrder order = failedOrder();
        UUID incident = workOrder(order, "INCIDENT");
        UUID maintenance = workOrder(order, "MAINTENANCE");
        UUID payment = paymentOf(order);
        var body = new HashMap<String, Object>(Map.of("reason", "DISPENSE_FAILED", "transferReference", "FT-WO-1"));
        body.put("workOrderId", maintenance);
        fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", body, admin.token(), 400);
        body.put("workOrderId", UUID.randomUUID());
        fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", body, admin.token(), 400);
        assertThat(paymentStatus(referenceOf(order.orderId()))).isEqualTo("SUCCESS");
        body.put("workOrderId", incident);
        fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", body, admin.token(), 200);
        assertThat(count("SELECT count(*) FROM work_order_events WHERE work_order_id=? AND type='NOTE' AND actor_id=? AND note LIKE ?",
                incident, admin.id(), "Refunded%" + order.orderCode() + "%FT-WO-1%")).isEqualTo(1);

        PlacedOrder cancelledCase = failedOrder();
        UUID cancelled = workOrder(cancelledCase, "INCIDENT");
        fixtures.api("POST", "/api/v1/work-orders/" + cancelled + "/cancel", Map.of("reason", "Khong can", "version", version(cancelled)), admin.token(), 200);
        body.put("transferReference", "FT-WO-2");
        body.put("workOrderId", cancelled);
        fixtures.response("POST", "/api/v1/payments/" + paymentOf(cancelledCase) + "/refund", body, admin.token(), 400);
    }

    // ---- 9. interactions ----

    @Test
    void webhooksAndLateDispenseResultsAfterARefundKeepTheRefund() throws Exception {
        PlacedOrder order = failedOrder();
        String reference = referenceOf(order.orderId());
        UUID payment = paymentId(reference);
        refund(payment, "DISPENSE_FAILED", "FT-AFTER-1", null, 200);
        assertThat(paid(reference, "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(paid(reference, "TXN-OTHER-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("REFUNDED");

        UUID bowl = bowlOf(order.orderId());
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, commandCode(order))).isEqualTo(DispenseService.Outcome.APPLIED);
        assertThat(orderStatus(order.orderId())).isEqualTo("REFUNDED");
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, bowl)).isEqualTo("SOLD");
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='DISPENSE_SUCCESS_AFTER_REFUND'")).isEqualTo(1);
    }

    // ---- 10. candidates and views ----

    @Test
    void candidatesListEachTypeWithThePayerFromTheVerifiedWebhookOnly(CapturedOutput output) throws Exception {
        PlacedOrder failed = paidOrderWithPayer(true);
        abort(failed);
        PlacedOrder late = placeOrder();
        pay(late, 201);
        kioskJson("POST", late.order() + "/cancel", late.shop().key(), null, 200);
        paid(referenceOf(late.orderId()), "TXN-L-" + late.orderId(), orderTotal(late.orderId()));
        PlacedOrder doubled = completedOrder();
        UUID payingOfDoubled = paymentOf(doubled);
        String second = insertPendingAttempt(doubled.orderId(), "TEST-CAND-" + doubled.orderId().toString().substring(0, 8), orderTotal(doubled.orderId()));
        paid(second, "TXN-CAND-" + doubled.orderId(), orderTotal(doubled.orderId()));
        PlacedOrder dispensing = paidOrder(); // not a candidate yet
        PlacedOrder done = completedOrder(); // nothing to refund

        Map<UUID, String> mine = Map.of(paymentOf(failed), "DISPENSE_FAILED", paymentOf(late), "LATE_PAYMENT", paymentId(second), "DUPLICATE_PAYMENT");
        JsonNode all = candidates("");
        Map<String, JsonNode> byType = new HashMap<>();
        all.path("content").forEach(item -> {
            UUID id = UUID.fromString(item.path("paymentId").asText());
            if (mine.containsKey(id)) byType.put(item.path("type").asText(), item);
            assertThat(id).isNotIn(paymentOf(dispensing), paymentOf(done), payingOfDoubled);
        });
        assertThat(byType.keySet()).containsExactlyInAnyOrder("DISPENSE_FAILED", "LATE_PAYMENT", "DUPLICATE_PAYMENT");
        byType.forEach((type, item) -> assertThat(mine.get(UUID.fromString(item.path("paymentId").asText()))).isEqualTo(type));
        JsonNode failedItem = byType.get("DISPENSE_FAILED");
        assertThat(failedItem.path("order").path("orderCode").asText()).isEqualTo(failed.orderCode());
        assertThat(failedItem.path("order").path("status").asText()).isEqualTo("DISPENSE_FAILED");
        assertThat(failedItem.path("payer").path("accountName").asText()).isEqualTo("NGUYEN VAN A");
        assertThat(failedItem.path("payer").path("accountNumber").asText()).isEqualTo(PAYER_ACCOUNT);
        assertThat(failedItem.path("payer").path("bankId").asText()).isEqualTo("970436");
        assertThat(failedItem.path("payer").path("bankName").asText()).isEqualTo("Vietcombank");
        assertThat(failedItem.path("waitingSince").asText()).isEqualTo(failedItem.path("paidAt").asText());
        assertThat(byType.get("LATE_PAYMENT").path("payer").isNull()).isTrue();
        assertThat(byType.get("LATE_PAYMENT").path("order").path("status").asText()).isEqualTo("CANCELLED");
        List<String> waiting = new ArrayList<>();
        all.path("content").forEach(item -> waiting.add(item.path("waitingSince").asText()));
        assertThat(waiting).isSortedAccordingTo(java.util.Comparator.comparing(java.time.Instant::parse));

        for (var entry : mine.entrySet()) {
            for (String type : List.of("DISPENSE_FAILED", "LATE_PAYMENT", "DUPLICATE_PAYMENT")) {
                List<String> ids = ids(candidates("type=" + type));
                assertThat(ids.contains(entry.getKey().toString())).as(type + " " + entry.getValue()).isEqualTo(type.equals(entry.getValue()));
            }
        }
        assertThat(candidates("type=CUSTOMER_REPORT").path("content")).isEmpty();
        assertThat(ids(candidates("machineId=" + failed.shop().machineId()))).containsExactly(paymentOf(failed).toString());
        LocalDate today = calendar.today();
        assertThat(ids(candidates("from=" + today + "&to=" + today))).containsAll(mine.keySet().stream().map(UUID::toString).toList());
        assertThat(candidates("from=" + today.plusDays(1)).path("totalElements").asLong()).isZero();
        fixtures.response("GET", "/api/v1/refunds/candidates?from=" + today + "&to=" + today.minusDays(1), null, admin.token(), 400);
        fixtures.response("GET", "/api/v1/refunds/candidates?type=NOPE", null, admin.token(), 400);

        // Refunded payments disappear.
        refund(paymentOf(failed), "DISPENSE_FAILED", "FT-CAND-1", null, 200);
        assertThat(ids(candidates(""))).doesNotContain(paymentOf(failed).toString()).contains(paymentOf(late).toString());
        assertThat(output.getAll()).doesNotContain(PAYER_ACCOUNT, "FT-CAND-1");
        assertThat(dispensing.orderId()).isNotEqualTo(done.orderId());
    }

    @Test
    void anUnverifiedWebhookNeverProvidesThePayer() throws Exception {
        PlacedOrder order = paidOrderWithPayer(false);
        abort(order);
        JsonNode item = fixtures.api("GET", "/api/v1/refunds/candidates?type=DISPENSE_FAILED&machineId=" + order.shop().machineId(), null, admin.token(), 200)
                .path("content").get(0);
        assertThat(item.path("paymentId").asText()).isEqualTo(paymentOf(order).toString());
        assertThat(item.path("payer").isNull()).isTrue();
        assertThat(count("SELECT count(*) FROM payment_webhook_logs WHERE is_verified=false AND raw_body LIKE '%counterAccountNumber%'")).isEqualTo(1);
    }

    @Test
    void refundListAndSummaryMatchTheDatabaseAndUseBusinessDays(CapturedOutput output) throws Exception {
        LocalDate today = calendar.today();
        UUID failed = paymentOf(failedOrder());
        refund(failed, "DISPENSE_FAILED", "FT-LIST-1", null, 200);
        PlacedOrder quality = completedOrder();
        UUID qualityPayment = paymentOf(quality);
        refund(qualityPayment, "PRODUCT_QUALITY", "FT-LIST-2", "Trai cay dap", 200);
        UUID late = paymentOf(lateOrder());
        refund(late, "LATE_PAYMENT", "FT-LIST-3", null, 200);

        JsonNode page = fixtures.api("GET", "/api/v1/refunds?size=100", null, admin.token(), 200);
        assertThat(page.path("totalElements").asLong()).isEqualTo(count("SELECT count(*) FROM payments WHERE status='REFUNDED'"));
        List<String> mine = List.of(failed.toString(), qualityPayment.toString(), late.toString());
        assertThat(ids(page).stream().filter(mine::contains).toList()).containsExactly(late.toString(), qualityPayment.toString(), failed.toString());
        JsonNode first = page.path("content").get(0);
        assertThat(first.path("paymentId").asText()).isEqualTo(late.toString());
        assertThat(first.path("refundedBy").path("id").asText()).isEqualTo(admin.id().toString());
        assertThat(first.path("refundedBy").path("fullName").isTextual()).isTrue();
        assertThat(first.path("order").path("status").asText()).isEqualTo("CANCELLED");
        assertThat(first.path("transferReference").asText()).isEqualTo("FT-LIST-3");
        assertThat(ids(fixtures.api("GET", "/api/v1/refunds?size=100&reason=PRODUCT_QUALITY", null, admin.token(), 200))).contains(qualityPayment.toString())
                .doesNotContain(failed.toString(), late.toString());
        JsonNode byMachine = fixtures.api("GET", "/api/v1/refunds?machineId=" + quality.shop().machineId(), null, admin.token(), 200);
        assertThat(ids(byMachine)).containsExactly(qualityPayment.toString());
        assertThat(byMachine.path("content").get(0).path("note").asText()).isEqualTo("Trai cay dap");
        assertThat(ids(fixtures.api("GET", "/api/v1/refunds?size=100&refundedBy=" + admin.id(), null, admin.token(), 200))).contains(late.toString());
        assertThat(fixtures.api("GET", "/api/v1/refunds?refundedBy=" + staff.id(), null, admin.token(), 200).path("totalElements").asLong()).isZero();
        assertThat(ids(fixtures.api("GET", "/api/v1/refunds?size=100&to=" + today.minusDays(1), null, admin.token(), 200))).doesNotContain(late.toString());

        assertSummaryMatchesDatabase(today, today);
        JsonNode tomorrow = fixtures.api("GET", "/api/v1/refunds/summary?from=" + today.plusDays(1), null, admin.token(), 200);
        assertThat(tomorrow.path("count").asLong()).isZero();
        assertThat(new BigDecimal(tomorrow.path("totalAmount").asText())).isEqualByComparingTo("0");
        assertThat(tomorrow.path("byReason")).hasSize(5);
        JsonNode machineSummary = fixtures.api("GET", "/api/v1/refunds/summary?machineId=" + quality.shop().machineId(), null, admin.token(), 200);
        assertThat(machineSummary.path("count").asLong()).isEqualTo(1);
        assertThat(new BigDecimal(machineSummary.path("totalAmount").asText())).isEqualByComparingTo("35000");

        // The business day of a refund is the Vietnam date: 23:30 in Vietnam yesterday is 16:30 UTC, still "yesterday".
        long yesterday = fixtures.api("GET", "/api/v1/refunds/summary?from=" + today.minusDays(1) + "&to=" + today.minusDays(1), null, admin.token(), 200)
                .path("count").asLong();
        long todayCount = fixtures.api("GET", "/api/v1/refunds/summary?from=" + today, null, admin.token(), 200).path("count").asLong();
        String lateEvening = calendar.dayStart(today).minusSeconds(1800).toString();
        jdbc.update("UPDATE payments SET created_at = ?::timestamptz - interval '2 hours', paid_at = ?::timestamptz - interval '1 hour',"
                + " refunded_at = ?::timestamptz WHERE id=?", lateEvening, lateEvening, lateEvening, failed);
        assertThat(fixtures.api("GET", "/api/v1/refunds/summary?from=" + today.minusDays(1) + "&to=" + today.minusDays(1), null, admin.token(), 200)
                .path("count").asLong()).isEqualTo(yesterday + 1);
        assertThat(fixtures.api("GET", "/api/v1/refunds/summary?from=" + today, null, admin.token(), 200).path("count").asLong()).isEqualTo(todayCount - 1);
        assertSummaryMatchesDatabase(today.minusDays(1), today);
        assertThat(output.getAll()).doesNotContain("FT-LIST-1", "FT-LIST-2", "FT-LIST-3");
    }

    private void assertSummaryMatchesDatabase(LocalDate from, LocalDate to) throws Exception {
        JsonNode summary = fixtures.api("GET", "/api/v1/refunds/summary?from=" + from + "&to=" + to, null, admin.token(), 200);
        String window = " FROM payments WHERE status='REFUNDED' AND refunded_at >= ?::timestamptz AND refunded_at < ?::timestamptz";
        String start = calendar.dayStart(from).toString(), end = calendar.dayEnd(to).toString();
        assertThat(summary.path("count").asLong()).isEqualTo(count("SELECT count(*)" + window, start, end));
        assertThat(new BigDecimal(summary.path("totalAmount").asText()))
                .isEqualByComparingTo(jdbc.queryForObject("SELECT coalesce(sum(amount), 0)" + window, BigDecimal.class, start, end));
        for (JsonNode row : summary.path("byReason")) {
            String reason = row.path("reason").asText();
            assertThat(row.path("count").asLong()).as(reason).isEqualTo(count("SELECT count(*)" + window + " AND refund_reason=?", start, end, reason));
            assertThat(new BigDecimal(row.path("totalAmount").asText())).as(reason).isEqualByComparingTo(
                    jdbc.queryForObject("SELECT coalesce(sum(amount), 0)" + window + " AND refund_reason=?", BigDecimal.class, start, end, reason));
        }
    }


    @Test
    void candidateAndRefundPagesUseAFixedNumberOfQueries() throws Exception {
        for (int n = 0; n < 3; n++) refund(paymentOf(failedOrder()), "DISPENSE_FAILED", "FT-NPLUS-" + n, null, 200);
        for (int n = 0; n < 3; n++) failedOrder();
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("admin", null,
                List.of(new SimpleGrantedAuthority("REFUND_READ"))));
        var statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
        assertThat(queries.candidates(null, null, null, null, 0, 1).content()).hasSize(1);
        long one = statistics.getPrepareStatementCount();
        statistics.clear();
        assertThat(queries.candidates(null, null, null, null, 0, 10).content()).hasSizeGreaterThanOrEqualTo(3);
        assertThat(statistics.getPrepareStatementCount()).isEqualTo(one);
        statistics.clear();
        assertThat(queries.list(null, null, null, null, null, 0, 1).content()).hasSize(1);
        long listOne = statistics.getPrepareStatementCount();
        statistics.clear();
        assertThat(queries.list(null, null, null, null, null, 0, 10).content()).hasSizeGreaterThanOrEqualTo(3);
        assertThat(statistics.getPrepareStatementCount()).isEqualTo(listOne).isLessThanOrEqualTo(2);
        statistics.clear();
        queries.candidates(RefundCandidateType.DISPENSE_FAILED, null, null, null, 0, 10);
        // count + page + duplicates + webhook payers + open customer reports (issue #74), whatever the page size
        assertThat(statistics.getPrepareStatementCount()).isLessThanOrEqualTo(5);
    }

    // ---- 11. security ----

    @Test
    void staffAnonymousAndKioskKeysHaveNoAccess() throws Exception {
        PlacedOrder order = failedOrder();
        UUID payment = paymentOf(order);
        for (String path : List.of("/api/v1/refunds", "/api/v1/refunds/candidates", "/api/v1/refunds/summary")) {
            fixtures.response("GET", path, null, staff.token(), 403);
            fixtures.response("GET", path, null, null, 401);
            assertThat(kioskCall("GET", path, order.shop().key(), null).getResponse().getStatus()).isEqualTo(401);
        }
        var body = Map.of("reason", "DISPENSE_FAILED", "transferReference", "FT-SEC-1");
        fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", body, staff.token(), 403);
        fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", body, null, 401);
        assertThat(kioskCall("POST", "/api/v1/payments/" + payment + "/refund", order.shop().key(), body).getResponse().getStatus()).isEqualTo(401);
        // A caller holding only PAYMENT_READ cannot record a refund.
        jdbc.update("INSERT INTO role_permissions (role_id, permission_id) SELECT '10000000-0000-0000-0000-000000000002', id FROM permissions WHERE code='PAYMENT_READ'");
        try {
            fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", body, staff.token(), 403);
        } finally {
            jdbc.update("DELETE FROM role_permissions WHERE role_id='10000000-0000-0000-0000-000000000002' AND permission_id=(SELECT id FROM permissions WHERE code='PAYMENT_READ')");
        }
        assertThat(paymentStatus(referenceOf(order.orderId()))).isEqualTo("SUCCESS");
    }

    // ---- helpers ----

    private JsonNode refund(UUID payment, String reason, String reference, String note, int expected) throws Exception {
        var body = new HashMap<String, Object>();
        body.put("reason", reason);
        body.put("transferReference", reference);
        if (note != null) body.put("note", note);
        return fixtures.response("POST", "/api/v1/payments/" + payment + "/refund", body, admin.token(), expected);
    }

    private int refundStatus(UUID payment, String reason, String reference) throws Exception {
        String body = json.writeValueAsString(Map.of("reason", reason, "transferReference", reference));
        return mvc.perform(post("/api/v1/payments/" + payment + "/refund").contentType("application/json").content(body)
                .header("Authorization", "Bearer " + admin.token())).andReturn().getResponse().getStatus();
    }

    private JsonNode candidates(String query) throws Exception {
        return fixtures.api("GET", "/api/v1/refunds/candidates?size=100" + (query.isEmpty() ? "" : "&" + query), null, admin.token(), 200);
    }

    private static List<String> ids(JsonNode page) {
        List<String> ids = new ArrayList<>();
        page.path("content").forEach(item -> ids.add(item.path("paymentId").asText()));
        return ids;
    }

    private static String message(JsonNode body) {
        return body.path("message").asText();
    }

    private PlacedOrder paidOrder() throws Exception {
        PlacedOrder order = placeOrder();
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        return order;
    }

    /** Paid through a webhook that carries the payer's account; verified or with a wrong signature (then a verified one without it). */
    private PlacedOrder paidOrderWithPayer(boolean verified) throws Exception {
        PlacedOrder order = placeOrder();
        pay(order, 201);
        String reference = referenceOf(order.orderId());
        String payer = ",\"counterAccountName\":\"NGUYEN VAN A\",\"counterAccountNumber\":\"" + PAYER_ACCOUNT
                + "\",\"counterAccountBankId\":\"970436\",\"counterAccountBankName\":\"Vietcombank\"}";
        String plain = webhookBody(reference, "TXN-" + order.orderId(), orderTotal(order.orderId()), "SUCCESS");
        String withPayer = plain.substring(0, plain.length() - 1) + payer;
        if (verified) {
            assertThat(send(withPayer)).isEqualTo(200);
        } else {
            webhook(WEBHOOK, withPayer, "0".repeat(64));
            assertThat(send(plain)).isEqualTo(200);
        }
        assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
        return order;
    }

    private PlacedOrder failedOrder() throws Exception {
        PlacedOrder order = paidOrder();
        abort(order);
        return order;
    }

    private void abort(PlacedOrder order) {
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ABORTED, commandCode(order));
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
    }

    private PlacedOrder completedOrder() throws Exception {
        PlacedOrder order = paidOrder();
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ACCEPTED, commandCode(order));
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, commandCode(order));
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        return order;
    }

    private PlacedOrder lateOrder() throws Exception {
        PlacedOrder order = placeOrder();
        pay(order, 201);
        kioskJson("POST", order.order() + "/cancel", order.shop().key(), null, 200);
        assertThat(paid(referenceOf(order.orderId()), "TXN-LATE-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
        return order;
    }

    private UUID workOrder(PlacedOrder order, String type) throws Exception {
        return UUID.fromString(fixtures.api("POST", "/api/v1/work-orders", Map.of("type", type, "machineId", order.shop().machineId(),
                "title", "Su co " + order.orderCode()), admin.token(), 201).path("id").asText());
    }

    private long version(UUID workOrder) {
        return jdbc.queryForObject("SELECT version FROM work_orders WHERE id=?", Long.class, workOrder);
    }

    private UUID paymentOf(PlacedOrder order) {
        return paymentId(referenceOf(order.orderId()));
    }

    private UUID bowlOf(UUID orderId) {
        return jdbc.queryForObject("SELECT a.inventory_item_id FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=?",
                UUID.class, orderId);
    }

    private String machineCode(PlacedOrder order) {
        return jdbc.queryForObject("SELECT code FROM machines WHERE id=?", String.class, order.shop().machineId());
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
