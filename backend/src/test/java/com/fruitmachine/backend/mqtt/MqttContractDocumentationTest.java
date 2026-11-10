package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.mqtt.contract.MachineChannel;
import com.fruitmachine.backend.mqtt.contract.MachineCommandType;
import com.fruitmachine.backend.mqtt.contract.MachineCommands;
import com.fruitmachine.backend.mqtt.contract.MachineErrorCode;
import com.fruitmachine.backend.mqtt.contract.MachineEventType;
import com.fruitmachine.backend.mqtt.contract.MachineTopic;
import com.fruitmachine.backend.mqtt.contract.MqttContract;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

/** Issue #49: api-contract/mqtt-contract.md, its examples, the backend constants and the MQTT docs cannot drift apart silently. */
class MqttContractDocumentationTest {
    static final Path CONTRACT = Path.of("../api-contract/mqtt-contract.md");
    static final Path EXAMPLES = Path.of("../api-contract/mqtt/examples");
    static final Pattern FIRST_COLUMN = Pattern.compile("^\\| `([^`]+)` \\|(.*)$");
    static final ObjectMapper JSON = new ObjectMapper();
    static final Map<String, String> CHANNEL_BY_PREFIX = Map.of("command-", MachineChannel.COMMANDS, "event-", MachineChannel.EVENTS,
            "status-", MachineChannel.STATUS, "heartbeat", MachineChannel.HEARTBEAT, "telemetry", MachineChannel.TELEMETRY);

    static String contract() throws IOException {
        return Files.readString(CONTRACT);
    }

    /** Text from the heading line that starts with {@code heading} up to the next heading of any level. */
    static String section(String markdown, String heading) {
        List<String> lines = markdown.lines().toList();
        int start = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (start < 0 && lines.get(i).startsWith(heading)) start = i;
            else if (start >= 0 && lines.get(i).startsWith("#")) return String.join("\n", lines.subList(start, i));
        }
        assertThat(start).as("heading %s", heading).isNotNegative();
        return String.join("\n", lines.subList(start, lines.size()));
    }

    /** Table rows of a section keyed by their backticked first column; the value is the remaining cells. */
    static Map<String, List<String>> rows(String section) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (String line : section.lines().toList()) {
            Matcher row = FIRST_COLUMN.matcher(line);
            if (!row.matches()) continue;
            List<String> cells = Arrays.stream(row.group(2).split("\\|")).map(String::strip).filter(c -> !c.isEmpty()).toList();
            assertThat(out.put(row.group(1), cells)).as("duplicate row %s", row.group(1)).isNull();
        }
        return out;
    }

    static List<String> names(Class<? extends Enum<?>> type) {
        return Arrays.stream(type.getEnumConstants()).map(Enum::name).toList();
    }

    static String channelOf(String file) {
        return CHANNEL_BY_PREFIX.entrySet().stream().filter(e -> file.startsWith(e.getKey())).map(Map.Entry::getValue).findFirst().orElseThrow();
    }

    static Map<String, JsonNode> examples() throws IOException {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        try (Stream<Path> files = Files.list(EXAMPLES)) {
            for (Path file : files.sorted().toList()) out.put(file.getFileName().toString(), JSON.readTree(file.toFile()));
        }
        return out;
    }

    @Test
    void headerStatesTheContractAndSchemaVersionOfTheCode() throws IOException {
        String header = section(contract(), "# MQTT Contract");
        assertThat(header).contains("Contract version:        " + MqttContract.CONTRACT_VERSION)
                .contains("Envelope schemaVersion:  " + MqttContract.SCHEMA_VERSION);
        assertThat(section(contract(), "## Change log")).contains("| " + MqttContract.CONTRACT_VERSION + " |");
        assertThat(rows(section(contract(), "## 2. Envelope")).keySet()).containsExactly(MqttContract.SCHEMA_VERSION_FIELD,
                MqttContract.MESSAGE_ID_FIELD, MqttContract.MACHINE_CODE_FIELD, MqttContract.PAYLOAD_FIELD);
        assertThat(section(contract(), "## 2. Envelope")).contains("at most " + MqttContract.MESSAGE_ID_MAX_LENGTH + " characters");
    }

    @Test
    void channelsCommandsAndEventTypesEqualTheConstants() throws IOException {
        var channels = rows(section(contract(), "## 1. Topics"));
        assertThat(channels.keySet()).containsExactlyElementsOf(MachineChannel.ALL);
        channels.forEach((channel, cells) -> assertThat(cells.get(0)).isEqualTo("`" + MachineTopic.of("vending", "{machineCode}", channel) + "`"));
        assertThat(section(contract(), "## 1. Topics")).contains(MachineChannel.SUBSCRIBED.stream()
                .map(c -> MachineTopic.allMachines("vending", c)).reduce((a, b) -> a + " and " + b).orElseThrow());

        assertThat(rows(section(contract(), "## 3. Commands")).keySet()).containsExactlyElementsOf(MachineCommandType.ALL);

        // 4.1 holds two tables: command type -> event prefix and phases, then one row per phase.
        Map<String, List<String>> lifecycle = new LinkedHashMap<>();
        List<String> phases = new ArrayList<>();
        rows(section(contract(), "### 4.1 Command lifecycle")).forEach((key, cells) -> {
            if (cells.get(0).matches("`[A-Z_]+_`")) lifecycle.put(key, cells);
            else phases.add(key);
        });
        assertThat(phases).containsExactlyElementsOf(MachineEventType.PHASES);
        assertThat(lifecycle.keySet()).containsExactlyElementsOf(MachineCommandType.ALL);
        List<String> documented = new ArrayList<>();
        lifecycle.forEach((type, cells) -> {
            assertThat(cells.get(0)).isEqualTo("`" + type + "_`");
            List<String> answered = Arrays.stream(cells.get(1).split(",")).map(String::strip).toList();
            assertThat(answered).as("phases of %s", type).isEqualTo(MachineEventType.LIFECYCLE.get(type));
            answered.forEach(phase -> documented.add(type + "_" + phase));
        });

        var other = rows(section(contract(), "### 4.2 Other events"));
        assertThat(other.keySet()).containsExactlyElementsOf(MachineEventType.OTHER);
        documented.addAll(other.keySet());
        assertThat(documented).containsExactlyElementsOf(MachineEventType.ALL);
        assertThat(MachineEventType.DISPENSE_PREFIX + MachineEventType.COMPLETED).isEqualTo(MachineEventType.DISPENSE_COMPLETED);
    }

    @Test
    void errorCodeCatalogEqualsTheConstantsAndEveryEntryHasACatalogStatus() throws IOException {
        var reasons = rows(section(contract(), "### 6.1"));
        var faults = rows(section(contract(), "### 6.2"));
        var resets = rows(section(contract(), "### 6.3"));
        assertThat(reasons.keySet()).containsExactlyElementsOf(names(MachineErrorCode.Reason.class));
        assertThat(faults.keySet()).containsExactlyElementsOf(names(MachineErrorCode.Fault.class));
        assertThat(resets.keySet()).containsExactlyElementsOf(names(MachineErrorCode.ResetReason.class));
        for (var fault : MachineErrorCode.Fault.values()) assertThat(faults.get(fault.name()).get(1)).as(fault.name()).isEqualTo(fault.severity().name());
        for (var catalog : List.of(reasons, faults, resets)) {
            catalog.forEach((code, cells) -> assertThat(cells.get(0)).as("catalog status of %s", code)
                    .matches("AGREED|PROPOSED — .{10,}"));
        }
    }

    @Test
    void everyExampleIsAValidEnvelopeListedInTheContract() throws IOException {
        var examples = examples();
        assertThat(examples).hasSize(12);
        assertThat(rows(section(contract(), "## 9. Examples")).keySet()).containsExactlyInAnyOrderElementsOf(examples.keySet());
        Set<String> reasons = new TreeSet<>(names(MachineErrorCode.Reason.class));
        Set<String> faults = new TreeSet<>(names(MachineErrorCode.Fault.class));
        Set<String> resets = new TreeSet<>(names(MachineErrorCode.ResetReason.class));
        examples.forEach((file, envelope) -> {
            assertThat(envelope.fieldNames()).toIterable().as(file).containsExactly(MqttContract.SCHEMA_VERSION_FIELD,
                    MqttContract.MESSAGE_ID_FIELD, MqttContract.MACHINE_CODE_FIELD, MqttContract.PAYLOAD_FIELD);
            assertThat(envelope.path(MqttContract.SCHEMA_VERSION_FIELD).isInt()).as(file).isTrue();
            assertThat(envelope.path(MqttContract.SCHEMA_VERSION_FIELD).asInt()).as(file).isEqualTo(MqttContract.SCHEMA_VERSION);
            String messageId = envelope.path(MqttContract.MESSAGE_ID_FIELD).asText();
            assertThat(messageId).as(file).isNotBlank().hasSizeLessThanOrEqualTo(MqttContract.MESSAGE_ID_MAX_LENGTH);
            assertThat(envelope.path(MqttContract.MACHINE_CODE_FIELD).asText()).as(file).isEqualTo("FV-DEV-001");
            JsonNode payload = envelope.path(MqttContract.PAYLOAD_FIELD);
            assertThat(payload.isObject()).as(file).isTrue();
            switch (channelOf(file)) {
                case MachineChannel.COMMANDS -> {
                    assertThat(MachineCommandType.ALL).as(file).contains(payload.path(MachineCommandType.TYPE_FIELD).asText());
                    assertThat(payload.path(MachineCommandType.COMMAND_ID_FIELD).asText()).as(file).matches(MqttContract.COMMAND_ID);
                    assertThat(payload.path(MachineCommandType.COLUMN_CODE_FIELD).asText()).as(file).isIn("A", "B");
                }
                case MachineChannel.EVENTS -> {
                    String type = payload.path(MachineEventType.EVENT_TYPE_FIELD).asText();
                    assertThat(MachineEventType.ALL).as(file).contains(type);
                    JsonNode details = payload.path(MachineEventType.DETAILS_FIELD);
                    assertThat(details.isObject()).as(file).isTrue();
                    if (details.has(MachineCommandType.COMMAND_ID_FIELD))
                        assertThat(details.path(MachineCommandType.COMMAND_ID_FIELD).asText()).as(file).matches(MqttContract.COMMAND_ID);
                    if (details.has(MachineEventType.REASON_FIELD)) assertThat(reasons).as(file).contains(details.path(MachineEventType.REASON_FIELD).asText());
                    if (type.equals(MachineEventType.FAULT)) assertThat(faults).as(file).contains(details.path(MachineEventType.CODE_FIELD).asText());
                    if (type.equals(MachineEventType.BOOT)) assertThat(resets).as(file).contains(details.path(MachineEventType.RESET_REASON_FIELD).asText());
                }
                case MachineChannel.STATUS -> assertThat(payload.path("state").asText()).as(file).isIn("ONLINE", "OFFLINE");
                case MachineChannel.HEARTBEAT -> assertThat(payload.fieldNames()).toIterable().as(file).contains("state", "uptimeSeconds", "firmwareVersion");
                case MachineChannel.TELEMETRY -> assertThat(payload.fieldNames()).toIterable().as(file).containsExactly("temperature", "humidity");
                default -> throw new AssertionError(file);
            }
        });
    }

    @Test
    void dispenseExampleHasExactlyTheKeysTheBackendPublishes() throws IOException {
        JsonNode produced = JSON.valueToTree(MachineCommands.dispense("FV-DEV-001", "D-7F3A91C2E4B05D18", "B"));
        JsonNode example = examples().get("command-dispense.json");
        assertThat(produced.fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> example.fieldNames());
        Set<String> examplePayload = new TreeSet<>();
        example.path(MqttContract.PAYLOAD_FIELD).fieldNames().forEachRemaining(examplePayload::add);
        Set<String> producedPayload = new TreeSet<>();
        produced.path(MqttContract.PAYLOAD_FIELD).fieldNames().forEachRemaining(producedPayload::add);
        // Issue #52: the backend sends columnCode, so the published payload has exactly the example's keys.
        assertThat(producedPayload).isEqualTo(examplePayload);
        assertThat(produced.path(MqttContract.PAYLOAD_FIELD).path(MachineCommandType.COLUMN_CODE_FIELD).asText()).isEqualTo("B");
        assertThat(produced.path(MqttContract.PAYLOAD_FIELD).path(MachineCommandType.TYPE_FIELD).asText()).isEqualTo(MachineCommandType.DISPENSE);
        assertThat(produced.path(MqttContract.SCHEMA_VERSION_FIELD).asInt()).isEqualTo(MqttContract.SCHEMA_VERSION);
        assertThat(produced.path(MqttContract.MESSAGE_ID_FIELD).asText()).hasSizeLessThanOrEqualTo(MqttContract.MESSAGE_ID_MAX_LENGTH);
    }

    @Test
    void topicsWithOtherThanThreeLevelsAreNotContractTopics() {
        assertThat(MachineTopic.parse("vending/FV-DEV-001/events")).contains(new MachineTopic("vending", "FV-DEV-001", "events"));
        for (String topic : List.of("vending/FV-DEV-001", "vending/FV-DEV-001/events/extra", "vending", "vending/FV-DEV-001/events/"))
            assertThat(MachineTopic.parse(topic)).as(topic).isEmpty();
        assertThat(MachineTopic.allMachines("vending", MachineChannel.EVENTS)).isEqualTo("vending/+/events");
    }

    @Test
    void mqttDocsLinkTheContractAndNoLongerDefineOldTopics() throws IOException {
        List<String> stale = new ArrayList<>();
        try (Stream<Path> docs = Files.walk(Path.of("../docs"))) {
            for (Path doc : docs.filter(p -> p.toString().endsWith(".md")).toList()) {
                if (Files.readString(doc).contains("fruit-vending/")) stale.add(doc.toString());
            }
        }
        assertThat(stale).as("docs still using fruit-vending/ topics").isEmpty();
        for (String doc : List.of("mqtt-dispense.md", "backend-machine-health.md", "backend-machine-health-implementation.md",
                "backend-maintenance-clear-column.md", "backend-hardware-integration-tasks.md")) {
            assertThat(Files.readString(Path.of("../docs", doc))).as(doc).contains("api-contract/mqtt-contract.md");
        }
        for (String doc : List.of(".ai/ARCHITECTURE.md", ".ai/PROJECT.md", "../firmware/fruit/README.md"))
            assertThat(Files.readString(Path.of(doc))).as(doc).contains("api-contract/mqtt-contract.md");
    }

    @Test
    void brokerAclLetsEachMachineWriteOnlyItsOwnMachineChannels() throws IOException {
        List<String> acl = Files.readAllLines(Path.of("../infra/mosquitto/acl")).stream().filter(l -> l.startsWith("pattern ")).toList();
        List<String> expected = new ArrayList<>(List.of("pattern read vending/%u/" + MachineChannel.COMMANDS));
        for (String channel : MachineChannel.ALL) if (!channel.equals(MachineChannel.COMMANDS)) expected.add("pattern write vending/%u/" + channel);
        assertThat(acl).containsExactlyElementsOf(expected);
        assertThat(contract()).contains("infra/mosquitto/acl");
    }
}
