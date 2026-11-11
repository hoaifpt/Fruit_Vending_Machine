package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.mqtt.config.MqttProperties;
import com.fruitmachine.backend.mqtt.inbound.MachineMessageParser;
import com.fruitmachine.backend.mqtt.inbound.RejectionReason;
import com.fruitmachine.backend.mqtt.message.MachineChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import static org.assertj.core.api.Assertions.assertThat;

/** Keeps api-contract/mqtt-contract.md, the local broker ACL and the parser constants consistent. */
class MqttContractDocumentationTest {
    final MqttProperties defaults = new Binder(new MapConfigurationPropertySource(java.util.Map.of())).bindOrCreate("app.mqtt", MqttProperties.class);

    @Test
    void contractDocumentsTheParserConstants() throws Exception {
        String contract = Files.readString(Path.of("../api-contract/mqtt-contract.md"));
        for (MachineChannel channel : MachineChannel.values()) {
            assertThat(contract).contains("`vending/{machineCode}/" + channel.topicLevel() + "`", "`vending/+/" + channel.topicLevel() + "`");
        }
        for (RejectionReason reason : RejectionReason.values()) assertThat(contract).contains("`" + reason.name() + "`");
        assertThat(contract).contains("schemaVersion " + MachineMessageParser.SUPPORTED_SCHEMA_VERSION, "supported: `" + MachineMessageParser.SUPPORTED_SCHEMA_VERSION + "`",
                "1–" + MachineMessageParser.MAX_MESSAGE_ID_LENGTH + " visible ASCII", "`" + MachineMessageParser.MACHINE_CODE.pattern() + "`",
                "**" + defaults.maxPayloadBytes() + " bytes**", "`" + defaults.topicRoot() + "`", "machine code, not machine UUID", "QoS 1", "Last Will");
        // No command channel of any kind is documented or parsed.
        assertThat(Arrays.stream(MachineChannel.values()).map(MachineChannel::topicLevel)).containsExactly("telemetry", "status", "events");
        assertThat(contract).doesNotContain("vending/{machineCode}/command", "vending/{machineCode}/dispense");
    }

    @Test
    void localBrokerDeniesAnonymousAndScopesEachMachineToItsOwnTopics() throws Exception {
        String conf = Files.readString(Path.of("../infra/mosquitto/config/mosquitto.conf"));
        String acl = Files.readString(Path.of("../infra/mosquitto/config/acl"));
        assertThat(conf).contains("allow_anonymous false", "password_file /mosquitto/config/passwd", "acl_file /mosquitto/config/acl");
        for (MachineChannel channel : MachineChannel.values()) {
            assertThat(acl).contains("topic read vending/+/" + channel.topicLevel(), "pattern write vending/%u/" + channel.topicLevel());
        }
        assertThat(acl.lines().filter(line -> !line.startsWith("#") && line.contains("write")))
                .allMatch(line -> line.startsWith("pattern write vending/%u/"));
        // The generated password file (hashes of real local passwords) is never committed.
        assertThat(Files.readString(Path.of("../.gitignore"))).contains("/infra/mosquitto/config/passwd");
    }
}
