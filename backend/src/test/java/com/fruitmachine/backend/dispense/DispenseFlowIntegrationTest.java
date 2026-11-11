package com.fruitmachine.backend.dispense;

import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.dispense.service.DispenseService.Outcome;
import com.fruitmachine.backend.dispense.service.MachineCommandGateway;
import com.fruitmachine.backend.mqtt.MachineMessageHandler;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import static org.assertj.core.api.Assertions.assertThat;

/** Paid order -> dispense command -> machine reports, with a recording transport instead of a broker. */
@Import(DispenseFlowIntegrationTest.RecordingGatewayConfig.class)
class DispenseFlowIntegrationTest extends AbstractWebhookIntegrationTest {
    @Autowired DispenseService dispense;
    @Autowired MachineMessageHandler messages;
    @Autowired RecordingGateway transport;

    @BeforeEach
    void connect() {
        transport.sent.clear();
        transport.connected = true;
    }

    @Test
    void aVerifiedPaymentCreatesOneCommandThatIsDeliveredAfterCommitAndTheOrderStartsDispensing() throws Exception {
        PlacedOrder order = paidOrder();
        assertThat(count("SELECT count(*) FROM dispense_commands WHERE order_id=?", order.orderId())).isEqualTo(1);
        String code = commandCode(order);
        assertThat(code).matches("[A-Za-z0-9_-]{1,39}");
        assertThat(transport.sent).containsExactly(machineCode(order) + " " + code);
        assertThat(commandStatus(order)).isEqualTo("SENT");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");
        assertThat(kioskOrder(order).path("status").asText()).isEqualTo("DISPENSING");

        // A repeated webhook does not create a second command.
        paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()));
        assertThat(count("SELECT count(*) FROM dispense_commands WHERE order_id=?", order.orderId())).isEqualTo(1);
    }

    @Test
    void acceptedThenCompletedSellsTheBowlAndCompletesTheOrderOnce() throws Exception {
        PlacedOrder order = paidOrder();
        String machine = machineCode(order), code = commandCode(order);
        UUID bowl = bowlOf(order);

        assertThat(dispense.handleMachineEvent(machine, DispenseService.EVENT_ACCEPTED, code)).isEqualTo(Outcome.APPLIED);
        assertThat(commandStatus(order)).isEqualTo("ACKNOWLEDGED");
        assertThat(dispense.handleMachineEvent(machine, DispenseService.EVENT_COMPLETED, code)).isEqualTo(Outcome.APPLIED);

        assertThat(commandStatus(order)).isEqualTo("SUCCESS");
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, bowl)).isEqualTo("SOLD");
        assertThat(jdbc.queryForObject("SELECT status FROM order_item_allocations WHERE inventory_item_id=?", String.class, bowl)).isEqualTo("DISPENSED");
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=? AND type='SALE' AND status_after='SOLD'", bowl)).isEqualTo(1);
        assertThat(kioskOrder(order).path("status").asText()).isEqualTo("COMPLETED");

        // Duplicates (QoS 1 redelivery) change nothing.
        assertThat(dispense.handleMachineEvent(machine, DispenseService.EVENT_COMPLETED, code)).isEqualTo(Outcome.DUPLICATE);
        assertThat(dispense.handleMachineEvent(machine, DispenseService.EVENT_ABORTED, code)).isEqualTo(Outcome.IGNORED);
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=? AND type='SALE'", bowl)).isEqualTo(1);
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
    }

    @Test
    void anAbortedCycleFailsTheOrderAndBlocksTheBowlForStaff() throws Exception {
        PlacedOrder order = paidOrder();
        UUID bowl = bowlOf(order);
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ABORTED, commandCode(order))).isEqualTo(Outcome.APPLIED);
        assertThat(commandStatus(order)).isEqualTo("FAILED");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, bowl)).isEqualTo("DISPENSE_FAILED");
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE inventory_item_id=? AND type='ADJUSTMENT' AND reason='DISPENSE_ABORTED'", bowl)).isEqualTo(1);
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_ABORTED, commandCode(order))).isEqualTo(Outcome.DUPLICATE);
    }

    @Test
    void reportsFromAnotherMachineOrForUnknownCodesChangeNothing() throws Exception {
        PlacedOrder order = paidOrder();
        assertThat(dispense.handleMachineEvent("SOMEONE-ELSE", DispenseService.EVENT_COMPLETED, commandCode(order))).isEqualTo(Outcome.WRONG_MACHINE);
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, "D-UNKNOWN")).isEqualTo(Outcome.UNKNOWN_COMMAND);
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_REJECTED, commandCode(order))).isEqualTo(Outcome.IGNORED);
        assertThat(commandStatus(order)).isEqualTo("SENT");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");
    }

    @Test
    void withoutTransportTheCommandWaitsIsResentWhenConnectedAndTimesOutOtherwise() throws Exception {
        transport.connected = false;
        PlacedOrder order = paidOrder();
        UUID command = commandId(order);
        assertThat(commandStatus(order)).isEqualTo("PENDING");
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");

        transport.connected = true;
        clock.advance(Duration.ofSeconds(6));
        dispense.expireOrResend(command);
        assertThat(transport.sent).hasSize(1);
        assertThat(commandStatus(order)).isEqualTo("SENT");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");

        // Re-sent with the same code while unanswered; then given up after the timeout.
        clock.advance(Duration.ofSeconds(6));
        dispense.expireOrResend(command);
        assertThat(transport.sent).hasSize(2).allMatch(line -> line.endsWith(commandCode(order)));
        clock.advance(Duration.ofSeconds(60));
        dispense.expireOrResend(command);
        assertThat(commandStatus(order)).isEqualTo("TIMEOUT");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");

        // The machine is the witness: a late completion still sells the bowl and completes the order.
        assertThat(dispense.handleMachineEvent(machineCode(order), DispenseService.EVENT_COMPLETED, commandCode(order))).isEqualTo(Outcome.APPLIED);
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, bowlOf(order))).isEqualTo("SOLD");
    }

    @Test
    void mqttEnvelopesAreRoutedOnlyWhenTheTopicAndTheDeclaredMachineAgree() throws Exception {
        PlacedOrder order = paidOrder();
        String machine = machineCode(order), code = commandCode(order);
        String body = "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":\"%s\",\"payload\":{\"eventType\":\"DISPENSE_COMPLETED\",\"details\":{\"commandId\":\"%s\"}}}";

        messages.handle(machine, "events", body.formatted("OTHER", code).getBytes(StandardCharsets.UTF_8));
        messages.handle(machine, "events", "not json".getBytes(StandardCharsets.UTF_8));
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");

        messages.handle(machine, "events", body.formatted(machine, code).getBytes(StandardCharsets.UTF_8));
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(count("SELECT count(*) FROM machines WHERE code=? AND last_seen_at IS NOT NULL", machine)).isEqualTo(1);
    }

    private PlacedOrder paidOrder() throws Exception {
        PlacedOrder order = placeOrder();
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        return order;
    }

    private String machineCode(PlacedOrder order) {
        return jdbc.queryForObject("SELECT code FROM machines WHERE id=?", String.class, order.shop().machineId());
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

    private UUID bowlOf(PlacedOrder order) {
        return jdbc.queryForObject("SELECT inventory_item_id FROM dispense_commands WHERE order_id=?", UUID.class, order.orderId());
    }

    static final class RecordingGateway implements MachineCommandGateway {
        final List<String> sent = new CopyOnWriteArrayList<>();
        volatile boolean connected = true;

        @Override
        public boolean sendDispense(String machineCode, String commandCode) {
            if (!connected) return false;
            sent.add(machineCode + " " + commandCode);
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
