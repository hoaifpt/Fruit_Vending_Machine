package com.fruitmachine.backend.dispense;

import com.fruitmachine.backend.dispense.event.DispenseFailedEvent;
import com.fruitmachine.backend.dispense.event.DispenseLateSuccessEvent;
import com.fruitmachine.backend.dispense.event.DispenseMultipleBowlsEvent;
import com.fruitmachine.backend.dispense.service.DispenseReport;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.dispense.service.DispenseService.Outcome;
import com.fruitmachine.backend.dispense.service.MachineCommandGateway;
import com.fruitmachine.backend.machine.event.MachineMaintenanceEnteredEvent;
import com.fruitmachine.backend.machine.service.MachineService;
import com.fruitmachine.backend.mqtt.MachineMessageHandler;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;

/** Paid order -> dispense command -> machine reports, with a recording transport instead of a broker (issues #46, #52). */
@Import(DispenseFlowIntegrationTest.RecordingGatewayConfig.class)
@RecordApplicationEvents
class DispenseFlowIntegrationTest extends AbstractWebhookIntegrationTest {
    @Autowired DispenseService dispense;
    @Autowired MachineService machineService;
    @Autowired MachineMessageHandler messages;
    @Autowired RecordingGateway transport;
    @Autowired TransactionTemplate transactions;
    @Autowired ApplicationEvents events;

    @BeforeEach
    void connect() {
        transport.sent.clear();
        transport.connected = true;
    }

    // ---- delivery and payload ----

    @Test
    void aVerifiedPaymentCreatesOneCommandThatIsDeliveredAfterCommitWithItsColumn() throws Exception {
        PlacedOrder order = paidOrder();
        assertThat(count("SELECT count(*) FROM dispense_commands WHERE order_id=?", order.orderId())).isEqualTo(1);
        String code = commandCode(order);
        assertThat(code).matches("[A-Za-z0-9_-]{1,39}");
        assertThat(transport.sent).containsExactly(machineCode(order) + " " + code + " A");
        assertThat(commandStatus(order)).isEqualTo("SENT");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");
        assertThat(kioskOrder(order).path("status").asText()).isEqualTo("DISPENSING");

        // A repeated webhook does not create a second command.
        paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()));
        assertThat(count("SELECT count(*) FROM dispense_commands WHERE order_id=?", order.orderId())).isEqualTo(1);
    }

    @Test
    void theColumnCodeIsTheSlotCodeOfTheReservedBowl() throws Exception {
        Shop shop = shopWithTwoColumns();
        PlacedOrder first = paid(placeOrder(shop)), second = paid(placeOrder(shop));
        assertThat(slotCode(first)).isEqualTo("A");
        assertThat(slotCode(second)).isEqualTo("B");
        assertThat(dispense.handleMachineEvent(machineCode(first), DispenseService.EVENT_COMPLETED, commandCode(first))).isEqualTo(Outcome.APPLIED);
        clock.advance(Duration.ofSeconds(6));
        dispense.expireOrResend(commandId(second));
        assertThat(transport.sent).containsExactly(machineCode(first) + " " + commandCode(first) + " A", machineCode(second) + " " + commandCode(second) + " B");
    }

    // ---- results ----

    @Test
    void acceptedThenCompletedSellsTheBowlAndCompletesTheOrderOnce() throws Exception {
        PlacedOrder order = paidOrder();
        String machine = machineCode(order), code = commandCode(order);
        UUID bowl = bowlOf(order);

        assertThat(dispense.handleMachineEvent(machine, DispenseService.EVENT_ACCEPTED, code)).isEqualTo(Outcome.APPLIED);
        assertThat(commandStatus(order)).isEqualTo("ACKNOWLEDGED");
        assertThat(dispense.handleMachineEvent(machine, DispenseService.EVENT_COMPLETED, code)).isEqualTo(Outcome.APPLIED);

        assertThat(commandStatus(order)).isEqualTo("SUCCESS");
        assertThat(failureReason(order)).isNull();
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(bowlStatus(bowl)).isEqualTo("SOLD");
        assertThat(jdbc.queryForObject("SELECT status FROM order_item_allocations WHERE inventory_item_id=?", String.class, bowl)).isEqualTo("DISPENSED");
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=? AND type='SALE' AND status_after='SOLD'", bowl)).isEqualTo(1);
        assertThat(kioskOrder(order).path("status").asText()).isEqualTo("COMPLETED");
        assertThat(machineStatus(order)).isEqualTo("ACTIVE");

        // Duplicates (QoS 1 redelivery) change nothing.
        assertThat(dispense.handleMachineEvent(machine, DispenseService.EVENT_COMPLETED, code)).isEqualTo(Outcome.DUPLICATE);
        assertThat(dispense.handleMachineEvent(machine, DispenseService.EVENT_ABORTED, code)).isEqualTo(Outcome.IGNORED);
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=? AND type='SALE'", bowl)).isEqualTo(1);
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
    }

    @Test
    void reportsFromAnotherMachineOrForUnknownCodesChangeNothing() throws Exception {
        PlacedOrder order = paidOrder();
        assertThat(dispense.handleMachineEvent("SOMEONE-ELSE", DispenseService.EVENT_COMPLETED, commandCode(order))).isEqualTo(Outcome.WRONG_MACHINE);
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, "D-UNKNOWN")).isEqualTo(Outcome.UNKNOWN_COMMAND);
        assertThat(dispense.handleMachineEvent(machineCode(order), "DISPENSE_SOMETHING_NEW", commandCode(order))).isEqualTo(Outcome.IGNORED);
        assertThat(commandStatus(order)).isEqualTo("SENT");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");
    }

    // ---- reasons ----

    @ParameterizedTest
    @ValueSource(strings = {"", "BUSY", "SOMETHING_NEW"})
    void rejectedBusyWithoutOrWithUnknownReasonKeepsTheCommandOpenAndResendsIt(String reason) throws Exception {
        PlacedOrder order = paidOrder();
        assertThat(dispense.handleMachineEvent(machineCode(order), report(DispenseService.EVENT_REJECTED, order, reason.isEmpty() ? null : reason)))
                .isEqualTo(Outcome.IGNORED);
        assertThat(commandStatus(order)).isEqualTo("SENT");
        clock.advance(Duration.ofSeconds(6));
        dispense.expireOrResend(commandId(order));
        assertThat(transport.sent).hasSize(2).allMatch(line -> line.contains(commandCode(order)));
        assertThat(machineStatus(order)).isEqualTo("ACTIVE");
    }

    @Test
    void rejectedControllerFaultReturnsTheBowlAndPutsTheMachineInMaintenance() throws Exception {
        PlacedOrder order = paidOrder();
        UUID bowl = bowlOf(order);
        assertThat(dispense.handleMachineEvent(machineCode(order), report(DispenseService.EVENT_REJECTED, order, "CONTROLLER_FAULT"))).isEqualTo(Outcome.APPLIED);
        assertSafeFailure(order, bowl, "CONTROLLER_FAULT");
        assertThat(machineStatus(order)).isEqualTo("MAINTENANCE");
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='MACHINE_MAINTENANCE_AUTO' AND entity_id=? AND user_id IS NULL", order.shop().machineId())).isEqualTo(1);
        assertThat(events.stream(MachineMaintenanceEnteredEvent.class).filter(e -> e.machineId().equals(order.shop().machineId()))).hasSize(1);
        // Never re-sent, and the machine sells nothing until an administrator reactivates it.
        clock.advance(Duration.ofSeconds(30));
        dispense.expireOrResend(commandId(order));
        assertThat(transport.sent).hasSize(1);
        kioskJson("POST", "/api/v1/kiosk/orders", order.shop().key(), orderBody(order.shop().productId()), 409);
    }

    @ParameterizedTest
    @ValueSource(strings = {"INVALID_COLUMN", "INVALID_COMMAND_ID", "UNSUPPORTED_SCHEMA"})
    void rejectedInvalidCommandReturnsTheBowlAndLeavesTheMachineAlone(String reason) throws Exception {
        PlacedOrder order = paidOrder();
        UUID bowl = bowlOf(order);
        assertThat(dispense.handleMachineEvent(machineCode(order), report(DispenseService.EVENT_REJECTED, order, reason))).isEqualTo(Outcome.APPLIED);
        assertSafeFailure(order, bowl, reason);
        assertThat(machineStatus(order)).isEqualTo("ACTIVE");
        // The returned bowl is still the head of its column and can be sold again.
        var next = placeOrder(order.shop());
        assertThat(bowlOf(next.orderId())).isEqualTo(bowl);
    }

    @ParameterizedTest
    @ValueSource(strings = {"MANUAL_STOP", "NO_BOWL_DETECTED", "INTERRUPTED_BY_REBOOT", "CONTROLLER_FAULT", "", "SOMETHING_NEW"})
    void anAbortedCycleBlocksTheBowlFailsTheOrderAndStopsTheMachine(String reason) throws Exception {
        PlacedOrder order = paidOrder();
        UUID bowl = bowlOf(order);
        String expected = List.of("", "SOMETHING_NEW").contains(reason) ? "ABORTED_UNSPECIFIED" : reason;
        assertThat(dispense.handleMachineEvent(machineCode(order), report(DispenseService.EVENT_ABORTED, order, reason.isEmpty() ? null : reason)))
                .isEqualTo(Outcome.APPLIED);
        assertThat(commandStatus(order)).isEqualTo("FAILED");
        assertThat(failureReason(order)).isEqualTo(expected);
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
        assertThat(bowlStatus(bowl)).isEqualTo("DISPENSE_FAILED");
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=? AND type='ADJUSTMENT' AND reason=?", bowl, expected)).isEqualTo(1);
        assertThat(machineStatus(order)).isEqualTo("MAINTENANCE");
        assertThat(events.stream(DispenseFailedEvent.class).filter(e -> e.orderId().equals(order.orderId())))
                .singleElement().satisfies(e -> {
                    assertThat(e.reason()).isEqualTo(expected);
                    assertThat(e.bowlReturned()).isFalse();
                    assertThat(e.slotId()).isEqualTo(order.shop().slotId());
                });
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ABORTED, commandCode(order))).isEqualTo(Outcome.DUPLICATE);
        clock.advance(Duration.ofSeconds(30));
        dispense.expireOrResend(commandId(order));
        assertThat(transport.sent).hasSize(1);
    }

    @Test
    void notExecutedAfterTheMachineHadAcceptedTheCommandIsTreatedAsUnknownOutcome() throws Exception {
        PlacedOrder order = paidOrder();
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ACCEPTED, commandCode(order));
        assertThat(dispense.handleMachineEvent(machineCode(order), report(DispenseService.EVENT_REJECTED, order, "INVALID_COLUMN"))).isEqualTo(Outcome.APPLIED);
        assertThat(bowlStatus(bowlOf(order))).isEqualTo("DISPENSE_FAILED");
        assertThat(machineStatus(order)).isEqualTo("MAINTENANCE");
    }

    @Test
    void mqttEnvelopesPassReasonAndBowlCountAndAreRoutedOnlyWhenTheTopicAndTheDeclaredMachineAgree() throws Exception {
        PlacedOrder order = paidOrder();
        String machine = machineCode(order), code = commandCode(order);
        String body = "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":\"%s\",\"payload\":{\"eventType\":\"%s\",\"details\":{\"commandId\":\"%s\"%s}}}";

        messages.handle(machine, "events", body.formatted("OTHER", "DISPENSE_COMPLETED", code, "").getBytes(StandardCharsets.UTF_8));
        messages.handle(machine, "events", "not json".getBytes(StandardCharsets.UTF_8));
        // A reason of the wrong type is treated as absent: REJECTED stays a resend.
        messages.handle(machine, "events", body.formatted(machine, "DISPENSE_REJECTED", code, ",\"reason\":7").getBytes(StandardCharsets.UTF_8));
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");

        messages.handle(machine, "events", body.formatted(machine, "DISPENSE_COMPLETED", code, ",\"bowlCount\":2").getBytes(StandardCharsets.UTF_8));
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(machineStatus(order)).isEqualTo("MAINTENANCE");
        assertThat(count("SELECT count(*) FROM machines WHERE code=? AND last_seen_at IS NOT NULL", machine)).isEqualTo(1);
    }

    // ---- multi-bowl ----

    @Test
    void severalBowlsSellTheOrderedBowlOnlyAndPutTheMachineInMaintenance() throws Exception {
        PlacedOrder order = paidOrder();
        UUID bowl = bowlOf(order);
        var others = jdbc.queryForList("SELECT id, status FROM inventory_items WHERE slot_id=? AND id<>? ORDER BY id", order.shop().slotId(), bowl);
        assertThat(dispense.handleMachineEvent(machineCode(order), new DispenseReport(DispenseService.EVENT_COMPLETED, commandCode(order), null, 2)))
                .isEqualTo(Outcome.APPLIED);
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(bowlStatus(bowl)).isEqualTo("SOLD");
        assertThat(machineStatus(order)).isEqualTo("MAINTENANCE");
        assertThat(jdbc.queryForList("SELECT id, status FROM inventory_items WHERE slot_id=? AND id<>? ORDER BY id", order.shop().slotId(), bowl)).isEqualTo(others);
        assertThat(events.stream(DispenseMultipleBowlsEvent.class).filter(e -> e.orderId().equals(order.orderId())))
                .singleElement().satisfies(e -> assertThat(e.bowlCount()).isEqualTo(2));

        // The reason alone means the same; one bowl (or no count, firmware v0.3.0) does not.
        PlacedOrder byReason = paidOrder();
        dispense.handleMachineEvent(machineCode(byReason), new DispenseReport(DispenseService.EVENT_COMPLETED, commandCode(byReason), "MULTIPLE_BOWLS_DETECTED", null));
        assertThat(machineStatus(byReason)).isEqualTo("MAINTENANCE");
        PlacedOrder single = paidOrder();
        dispense.handleMachineEvent(machineCode(single), new DispenseReport(DispenseService.EVENT_COMPLETED, commandCode(single), null, 1));
        assertThat(machineStatus(single)).isEqualTo("ACTIVE");
    }

    // ---- preconditions and one command per machine ----

    @Test
    void aMachineOrSlotThatIsNotActiveKeepsTheCommandPendingUntilItIsActiveAgain() throws Exception {
        for (String blocker : List.of("MACHINE", "SLOT")) {
            PlacedOrder order = placeOrder();
            pay(order, 201);
            if (blocker.equals("MACHINE")) jdbc.update("UPDATE machines SET status='MAINTENANCE' WHERE id=?", order.shop().machineId());
            else jdbc.update("UPDATE machine_slots SET status='INACTIVE' WHERE id=?", order.shop().slotId());
            transport.sent.clear();
            assertThat(paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
            assertThat(commandStatus(order)).as(blocker).isEqualTo("PENDING");
            clock.advance(Duration.ofSeconds(30));
            dispense.expireOrResend(commandId(order));
            assertThat(transport.sent).as(blocker).isEmpty();
            assertThat(commandStatus(order)).as(blocker).isEqualTo("PENDING");

            if (blocker.equals("MACHINE")) jdbc.update("UPDATE machines SET status='ACTIVE' WHERE id=?", order.shop().machineId());
            else jdbc.update("UPDATE machine_slots SET status='ACTIVE' WHERE id=?", order.shop().slotId());
            dispense.expireOrResend(commandId(order));
            assertThat(transport.sent).as(blocker).containsExactly(machineCode(order) + " " + commandCode(order) + " A");
            assertThat(commandStatus(order)).as(blocker).isEqualTo("SENT");
        }
    }

    @Test
    void theSecondCommandOfAMachineIsPublishedOnlyAfterTheFirstEnded() throws Exception {
        Shop shop = shopWithTwoColumns();
        PlacedOrder first = paid(placeOrder(shop)), second = paid(placeOrder(shop));
        assertThat(commandStatus(first)).isEqualTo("SENT");
        assertThat(commandStatus(second)).isEqualTo("PENDING");
        dispense.handleMachineEvent(machineCode(first), DispenseService.EVENT_ACCEPTED, commandCode(first));
        clock.advance(Duration.ofSeconds(6));
        dispense.expireOrResend(commandId(second));
        assertThat(commandStatus(second)).isEqualTo("PENDING");
        assertThat(transport.sent).hasSize(1);

        dispense.handleMachineEvent(machineCode(first), DispenseService.EVENT_COMPLETED, commandCode(first));
        dispense.expireOrResend(commandId(second));
        assertThat(commandStatus(second)).isEqualTo("SENT");
        assertThat(transport.sent).hasSize(2);
    }

    @Test
    void concurrentSweepsNeverPublishTwoCommandsOfOneMachine() throws Exception {
        for (int round = 0; round < 3; round++) {
            transport.connected = false;
            Shop shop = shopWithTwoColumns();
            PlacedOrder first = paid(placeOrder(shop)), second = paid(placeOrder(shop));
            transport.connected = true;
            transport.sent.clear();
            clock.advance(Duration.ofSeconds(6));
            UUID a = commandId(first), b = commandId(second);
            List<Callable<Integer>> tasks = new java.util.ArrayList<>();
            for (int i = 0; i < 4; i++) {
                UUID firstSend = i % 2 == 0 ? a : b;
                tasks.add(() -> { dispense.expireOrResend(a); return 0; });
                tasks.add(() -> { dispense.expireOrResend(b); return 0; });
                tasks.add(() -> { dispense.send(firstSend); return 0; });
            }
            parallel(tasks);
            assertThat(transport.sent.stream().map(line -> line.split(" ")[1]).distinct()).as("round %d", round).hasSize(1);
            assertThat(count("SELECT count(*) FROM dispense_commands WHERE machine_id=? AND status='SENT'", shop.machineId())).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM dispense_commands WHERE machine_id=? AND status='PENDING'", shop.machineId())).isEqualTo(1);
        }
    }

    // ---- timeouts ----

    @Test
    void neverPublishedWithinThePendingTimeoutReturnsTheBowl() throws Exception {
        transport.connected = false;
        PlacedOrder order = paidOrder();
        UUID bowl = bowlOf(order);
        assertThat(commandStatus(order)).isEqualTo("PENDING");
        clock.advance(Duration.ofSeconds(119));
        dispense.expireOrResend(commandId(order));
        assertThat(commandStatus(order)).isEqualTo("PENDING");
        clock.advance(Duration.ofSeconds(2));
        dispense.expireOrResend(commandId(order));
        assertSafeFailure(order, bowl, "NOT_DELIVERED");
        assertThat(machineStatus(order)).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("SELECT sent_at FROM dispense_commands WHERE order_id=?", Object.class, order.orderId())).isNull();
        // The payment stays SUCCESS: the order is a refund candidate.
        assertThat(paymentStatus(referenceOf(order.orderId()))).isEqualTo("SUCCESS");
        transport.connected = true;
        dispense.expireOrResend(commandId(order));
        assertThat(transport.sent).isEmpty();
    }

    @Test
    void theResultTimeoutCountsFromTheFirstDeliveryAndResendsDoNotMoveIt() throws Exception {
        transport.connected = false;
        PlacedOrder order = paidOrder();
        UUID command = commandId(order);
        // Undelivered for 100 s: with the old rule (timeout from creation) this command would already have failed.
        clock.advance(Duration.ofSeconds(100));
        transport.connected = true;
        dispense.expireOrResend(command);
        assertThat(commandStatus(order)).isEqualTo("SENT");
        var sentAt = jdbc.queryForObject("SELECT sent_at FROM dispense_commands WHERE id=?", java.time.OffsetDateTime.class, command);
        clock.advance(Duration.ofSeconds(6));
        dispense.expireOrResend(command);
        assertThat(transport.sent).hasSize(2).allMatch(line -> line.endsWith(commandCode(order) + " A"));
        assertThat(jdbc.queryForObject("SELECT sent_at FROM dispense_commands WHERE id=?", java.time.OffsetDateTime.class, command)).isEqualTo(sentAt);

        // 56 s after the first delivery: still open (and re-sent once more).
        clock.advance(Duration.ofSeconds(50));
        dispense.expireOrResend(command);
        assertThat(commandStatus(order)).isEqualTo("SENT");
        clock.advance(Duration.ofSeconds(5));
        dispense.expireOrResend(command);
        assertThat(commandStatus(order)).isEqualTo("TIMEOUT");
        assertThat(failureReason(order)).isEqualTo("RESULT_TIMEOUT");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
        assertThat(bowlStatus(bowlOf(order))).isEqualTo("DISPENSE_FAILED");
        assertThat(machineStatus(order)).isEqualTo("MAINTENANCE");
        int sends = transport.sent.size();
        clock.advance(Duration.ofSeconds(30));
        dispense.expireOrResend(command);
        assertThat(transport.sent).hasSize(sends);
    }

    // ---- late results ----

    @Test
    void lateCompletionOfAFailedOrderCompletesItAndTheMachineStaysInMaintenance() throws Exception {
        PlacedOrder order = paidOrder();
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ABORTED, commandCode(order));
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, commandCode(order))).isEqualTo(Outcome.APPLIED);
        assertThat(commandStatus(order)).isEqualTo("SUCCESS");
        assertThat(failureReason(order)).isNull();
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(bowlStatus(bowlOf(order))).isEqualTo("SOLD");
        assertThat(jdbc.queryForObject("SELECT status FROM order_item_allocations WHERE inventory_item_id=?", String.class, bowlOf(order))).isEqualTo("DISPENSED");
        assertThat(machineStatus(order)).isEqualTo("MAINTENANCE");
        assertThat(events.stream(DispenseLateSuccessEvent.class).filter(e -> e.orderId().equals(order.orderId()))).hasSize(1);
        // Duplicate late completion: no second history row.
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, commandCode(order))).isEqualTo(Outcome.DUPLICATE);
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=? AND type='SALE'", bowlOf(order))).isEqualTo(1);
    }

    @Test
    void lateCompletionOfARefundedOrderSellsTheBowlKeepsTheRefundAndIsFlagged() throws Exception {
        PlacedOrder order = paidOrder();
        dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ABORTED, commandCode(order));
        // REFUNDED is produced by 5.1; fixture order for the branch.
        jdbc.update("UPDATE orders SET status='REFUNDED' WHERE id=?", order.orderId());
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, commandCode(order))).isEqualTo(Outcome.APPLIED);
        assertThat(orderStatus(order.orderId())).isEqualTo("REFUNDED");
        assertThat(bowlStatus(bowlOf(order))).isEqualTo("SOLD");
        assertThat(commandStatus(order)).isEqualTo("SUCCESS");
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='DISPENSE_SUCCESS_AFTER_REFUND' AND entity_id=? AND user_id IS NULL", commandId(order))).isEqualTo(1);
        assertThat(events.stream(DispenseLateSuccessEvent.class).filter(e -> e.orderId().equals(order.orderId()))).isEmpty();
    }

    @Test
    void lateCompletionForABowlThatStaffRemovedOrThatWasReturnedChangesNothingAndIsRecorded() throws Exception {
        PlacedOrder removed = paidOrder();
        dispense.handleMachineEvent(machineCode(removed), DispenseService.EVENT_ABORTED, commandCode(removed));
        jdbc.update("UPDATE inventory_items SET status='REMOVED', removed_at=now() WHERE id=?", bowlOf(removed));

        transport.connected = false;
        PlacedOrder notDelivered = paidOrder();
        clock.advance(Duration.ofSeconds(121));
        dispense.expireOrResend(commandId(notDelivered));
        assertThat(failureReason(notDelivered)).isEqualTo("NOT_DELIVERED");

        for (PlacedOrder order : List.of(removed, notDelivered)) {
            var bowl = jdbc.queryForMap("SELECT status, sold_at FROM inventory_items WHERE id=?", bowlOf(order));
            String orderBefore = orderStatus(order.orderId());
            for (int i = 0; i < 2; i++) {
                assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, commandCode(order))).isEqualTo(Outcome.IGNORED);
            }
            assertThat(jdbc.queryForMap("SELECT status, sold_at FROM inventory_items WHERE id=?", bowlOf(order))).isEqualTo(bowl);
            assertThat(orderStatus(order.orderId())).isEqualTo(orderBefore);
            assertThat(commandStatus(order)).isEqualTo("FAILED");
            assertThat(count("SELECT count(*) FROM audit_logs WHERE action='DISPENSE_LATE_RESULT_CONFLICT' AND entity_id=?", commandId(order))).isEqualTo(1);
        }
    }

    // ---- machine maintenance by the system ----

    @Test
    void systemMaintenanceIsIdempotentLeavesInactiveMachinesAloneAndOnlyAnAdminReactivates() throws Exception {
        PlacedOrder order = paidOrder();
        UUID machine = order.shop().machineId();
        assertThat(enterMaintenance(machine)).isTrue();
        assertThat(enterMaintenance(machine)).isFalse();
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='MACHINE_MAINTENANCE_AUTO' AND entity_id=?", machine)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT new_value->>'reason' FROM audit_logs WHERE action='MACHINE_MAINTENANCE_AUTO' AND entity_id=?", String.class, machine))
                .isEqualTo("TEST_REASON");

        var catalog = kioskData("GET", "/api/v1/kiosk/catalog", order.shop().key(), null, 200);
        assertThat(catalog.path("acceptingOrders").asBoolean()).isFalse();
        kioskJson("POST", "/api/v1/kiosk/orders", order.shop().key(), orderBody(order.shop().productId()), 409);

        fixtures.response("PATCH", "/api/v1/machines/" + machine + "/status", Map.of("status", "ACTIVE"), staff.token(), 403);
        fixtures.api("PATCH", "/api/v1/machines/" + machine + "/status", Map.of("status", "ACTIVE"), admin.token(), 200);
        assertThat(machineStatus(order)).isEqualTo("ACTIVE");

        UUID inactive = fixtures.machine(admin.token());
        jdbc.update("UPDATE machines SET status='INACTIVE' WHERE id=?", inactive);
        assertThat(enterMaintenance(inactive)).isFalse();
        assertThat(jdbc.queryForObject("SELECT status FROM machines WHERE id=?", String.class, inactive)).isEqualTo("INACTIVE");
        assertThat(count("SELECT count(*) FROM audit_logs WHERE action='MACHINE_MAINTENANCE_AUTO' AND entity_id=?", inactive)).isZero();
    }

    // ---- helpers ----

    private Boolean enterMaintenance(UUID machineId) {
        return transactions.execute(status -> machineService.enterMaintenanceBySystem(machineId, "TEST_REASON"));
    }

    private void assertSafeFailure(PlacedOrder order, UUID bowl, String reason) {
        assertThat(commandStatus(order)).isEqualTo("FAILED");
        assertThat(failureReason(order)).isEqualTo(reason);
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
        assertThat(bowlStatus(bowl)).isEqualTo("AVAILABLE");
        assertThat(jdbc.queryForObject("SELECT reserved_at FROM inventory_items WHERE id=?", Object.class, bowl)).isNull();
        assertThat(jdbc.queryForObject("SELECT status FROM order_item_allocations WHERE inventory_item_id=? AND released_at IS NOT NULL", String.class, bowl))
                .isEqualTo("RELEASED");
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=? AND type='RETURN' AND reason=? AND status_after='AVAILABLE'", bowl, reason))
                .isEqualTo(1);
        assertThat(events.stream(DispenseFailedEvent.class).filter(e -> e.orderId().equals(order.orderId())))
                .singleElement().satisfies(e -> {
                    assertThat(e.reason()).isEqualTo(reason);
                    assertThat(e.bowlReturned()).isTrue();
                });
    }

    private DispenseReport report(String eventType, PlacedOrder order, String reason) {
        return new DispenseReport(eventType, commandCode(order), reason, null);
    }

    private PlacedOrder paid(PlacedOrder order) throws Exception {
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        return order;
    }

    private PlacedOrder paidOrder() throws Exception {
        return paid(placeOrder());
    }

    private String machineCode(PlacedOrder order) {
        return jdbc.queryForObject("SELECT code FROM machines WHERE id=?", String.class, order.shop().machineId());
    }

    private String machineStatus(PlacedOrder order) {
        return jdbc.queryForObject("SELECT status FROM machines WHERE id=?", String.class, order.shop().machineId());
    }

    private String commandCode(PlacedOrder order) {
        return jdbc.queryForObject("SELECT command_code FROM dispense_commands WHERE order_id=?", String.class, order.orderId());
    }

    private UUID commandId(PlacedOrder order) {
        return jdbc.queryForObject("SELECT id FROM dispense_commands WHERE order_id=?", UUID.class, order.orderId());
    }

    private String commandStatus(PlacedOrder order) {
        return jdbc.queryForObject("SELECT status FROM dispense_commands WHERE order_id=?", String.class, order.orderId());
    }

    private String failureReason(PlacedOrder order) {
        return jdbc.queryForObject("SELECT failure_reason FROM dispense_commands WHERE order_id=?", String.class, order.orderId());
    }

    private String slotCode(PlacedOrder order) {
        return jdbc.queryForObject("SELECT s.slot_code FROM dispense_commands c JOIN machine_slots s ON s.id=c.slot_id WHERE c.order_id=?", String.class, order.orderId());
    }

    private UUID bowlOf(PlacedOrder order) {
        return bowlOf(order.orderId());
    }

    private UUID bowlOf(UUID orderId) {
        return jdbc.queryForObject("SELECT a.inventory_item_id FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=?",
                UUID.class, orderId);
    }

    private String bowlStatus(UUID bowl) {
        return jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, bowl);
    }

    static final class RecordingGateway implements MachineCommandGateway {
        final List<String> sent = new CopyOnWriteArrayList<>();
        volatile boolean connected = true;

        @Override
        public boolean sendDispense(String machineCode, String commandCode, String columnCode) {
            if (!connected) return false;
            sent.add(machineCode + " " + commandCode + " " + columnCode);
            return true;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class RecordingGatewayConfig {
        @Bean
        @Primary
        RecordingGateway recordingGateway() {
            return new RecordingGateway();
        }
    }
}
