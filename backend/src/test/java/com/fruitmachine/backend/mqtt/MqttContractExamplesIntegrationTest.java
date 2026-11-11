package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.mqtt.contract.MachineChannel;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/** Issue #49 section 13: every machine-to-backend contract example is accepted by the handler; unknown-but-valid types are ignored. */
class MqttContractExamplesIntegrationTest extends AbstractCoreIntegrationTest {
    static final String MACHINE = "FV-DEV-001";

    @Autowired MachineMessageHandler messages;
    UUID machine;

    @BeforeEach
    void contractMachine() throws Exception {
        // Machines keep their readings (sensor_readings RESTRICT), so an earlier test machine is renamed, not deleted.
        jdbc.update("UPDATE machines SET code = 'OLD-' || id WHERE code = ?", MACHINE);
        machine = fixtures.machine(admin.token());
        jdbc.update("UPDATE machines SET code = ? WHERE id = ?", MACHINE, machine);
    }

    List<Path> inboundExamples() throws Exception {
        try (Stream<Path> files = Files.list(MqttContractDocumentationTest.EXAMPLES)) {
            return files.filter(f -> !MqttContractDocumentationTest.channelOf(f.getFileName().toString()).equals(MachineChannel.COMMANDS)).sorted().toList();
        }
    }

    Object lastSeen() {
        return jdbc.queryForObject("SELECT last_seen_at FROM machines WHERE id = ?", Object.class, machine);
    }

    @Test
    void everyInboundExampleIsAcceptedWithoutChangingOrdersOrInventory() throws Exception {
        List<Path> examples = inboundExamples();
        assertThat(examples).hasSize(10);
        long orders = jdbc.queryForObject("SELECT count(*) FROM orders", Long.class);
        long history = jdbc.queryForObject("SELECT count(*) FROM inventory_transactions", Long.class);
        for (Path example : examples) {
            String channel = MqttContractDocumentationTest.channelOf(example.getFileName().toString());
            jdbc.update("UPDATE machines SET last_seen_at = NULL, last_offline_at = NULL WHERE id = ?", machine);
            byte[] body = Files.readAllBytes(example);
            assertThatCode(() -> messages.handle(MACHINE, channel, body)).as(example.toString()).doesNotThrowAnyException();
            // Accepted: the envelope passed the checks and presence moved (the fake commandIds match no command). The Last Will
            // is the one message that records last_offline_at instead of last_seen_at (#53).
            if (example.getFileName().toString().equals("status-offline-lwt.json")) {
                assertThat(lastSeen()).as(example.toString()).isNull();
                assertThat(jdbc.queryForObject("SELECT last_offline_at FROM machines WHERE id = ?", Object.class, machine)).isNotNull();
            } else {
                assertThat(lastSeen()).as(example.toString()).isNotNull();
            }
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders", Long.class)).isEqualTo(orders);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions", Long.class)).isEqualTo(history);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sensor_readings WHERE machine_id = ?", Long.class, machine)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT firmware_version FROM machines WHERE id = ?", String.class, machine)).isEqualTo("0.3.0");
    }

    @Test
    void anExampleOnAnotherMachinesTopicIsDropped() throws Exception {
        byte[] body = Files.readAllBytes(MqttContractDocumentationTest.EXAMPLES.resolve("event-dispense-completed.json"));
        jdbc.update("UPDATE machines SET last_seen_at = NULL WHERE id = ?", machine);
        messages.handle("FV-DEV-002", MachineChannel.EVENTS, body);
        assertThat(lastSeen()).isNull();
        messages.handle(MACHINE, MachineChannel.EVENTS, "not json".getBytes());
        assertThat(lastSeen()).isNull();
    }
}
