package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.mqtt.config.MqttProperties;
import com.fruitmachine.backend.mqtt.inbound.MachineMessageParser;
import com.fruitmachine.backend.mqtt.inbound.MachineMessageRejectedException;
import com.fruitmachine.backend.mqtt.inbound.RejectionReason;
import com.fruitmachine.backend.mqtt.message.MachineChannel;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MachineMessageParserTest {
    static final Instant NOW = Instant.parse("2026-10-20T01:02:03.456Z");
    static final String CODE = "FV-HCM-001";

    static MqttProperties properties(int maxPayloadBytes) {
        return new MqttProperties(false, "tcp://127.0.0.1:1883", "fvm-backend", null, null, "vending", 1, false, maxPayloadBytes,
                Duration.ofSeconds(5), Duration.ofSeconds(30));
    }

    final MachineMessageParser parser = new MachineMessageParser(new ObjectMapper(), properties(8192), Clock.fixed(NOW, ZoneOffset.UTC));

    static String envelope(String extra) {
        return "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":\"" + CODE + "\",\"payload\":{\"temperature\":4.7}" + extra + "}";
    }

    MachineMessageParser.ParsedMessage parse(String topic, String body) {
        return parser.parse(topic, body.getBytes(StandardCharsets.UTF_8));
    }

    RejectionReason reason(String topic, String body) {
        return reason(topic, body.getBytes(StandardCharsets.UTF_8));
    }

    RejectionReason reason(String topic, byte[] body) {
        try {
            parser.parse(topic, body);
        } catch (MachineMessageRejectedException e) {
            return e.reason();
        }
        throw new AssertionError("message was accepted");
    }

    @Test
    void parsesEachChannelWithServerReceivedAtFromTheInjectedClock() {
        for (var entry : Map.of("telemetry", MachineChannel.TELEMETRY, "status", MachineChannel.STATUS, "events", MachineChannel.EVENT).entrySet()) {
            var parsed = parse("vending/" + CODE + "/" + entry.getKey(), envelope(",\"sentAt\":\"2026-10-20T00:05:00Z\""));
            assertThat(parsed.channel()).isEqualTo(entry.getValue());
            assertThat(parsed.machineCode()).isEqualTo(CODE);
            assertThat(parsed.messageId()).isEqualTo("m-1");
            assertThat(parsed.sentAt()).isEqualTo(Instant.parse("2026-10-20T00:05:00Z"));
            assertThat(parsed.receivedAt()).isEqualTo(NOW);
            assertThat(parsed.payload().path("temperature").asDouble()).isEqualTo(4.7);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"vending/FV-HCM-001", "vending/FV-HCM-001/telemetry/extra", "other/FV-HCM-001/telemetry", "VENDING/FV-HCM-001/telemetry",
            "vending//telemetry", "vending/fv-hcm-001/telemetry", "vending/FV HCM/telemetry", "vending/+/telemetry", "vending/#", "/vending/FV-HCM-001/telemetry",
            "vending/FV-HCM-001/telemetry/", "", "vending/-FV/telemetry"})
    void rejectsInvalidTopicShapes(String topic) {
        assertThat(reason(topic, envelope(""))).isEqualTo(RejectionReason.INVALID_TOPIC);
        assertThat(reason(null, envelope(""))).isEqualTo(RejectionReason.INVALID_TOPIC);
    }

    @ParameterizedTest
    @ValueSource(strings = {"commands", "dispense", "payment", "order", "Telemetry", "event", ""})
    void rejectsUnknownChannels(String channel) {
        assertThat(reason("vending/" + CODE + "/" + channel, envelope(""))).isEqualTo(RejectionReason.UNKNOWN_CHANNEL);
    }

    @Test
    void enforcesThePayloadSizeLimit() {
        var small = new MachineMessageParser(new ObjectMapper(), properties(256), Clock.fixed(NOW, ZoneOffset.UTC));
        String padded = envelope(",\"pad\":\"" + "x".repeat(256) + "\"");
        assertThatThrownBy(() -> small.parse("vending/" + CODE + "/telemetry", padded.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOfSatisfying(MachineMessageRejectedException.class, e -> assertThat(e.reason()).isEqualTo(RejectionReason.PAYLOAD_TOO_LARGE));
        String exact = envelope(",\"pad\":\"\"");
        String fits = envelope(",\"pad\":\"" + "x".repeat(256 - exact.length()) + "\"");
        assertThat(fits.length()).isEqualTo(256);
        assertThat(small.parse("vending/" + CODE + "/telemetry", fits.getBytes(StandardCharsets.UTF_8)).messageId()).isEqualTo("m-1");
        assertThat(reason("vending/" + CODE + "/telemetry", (byte[]) null)).isEqualTo(RejectionReason.PAYLOAD_TOO_LARGE);
    }

    @Test
    void rejectsInvalidJsonAndNonObjects() {
        String topic = "vending/" + CODE + "/telemetry";
        for (String body : new String[]{"", "not json", "[1,2]", "42", "\"text\"", "null", "{\"schemaVersion\":1", envelope("") + " {}",
                "{\"schemaVersion\":1,\"schemaVersion\":1,\"messageId\":\"m\",\"machineCode\":\"" + CODE + "\",\"payload\":{}}"}) {
            assertThat(reason(topic, body)).as(body).isEqualTo(RejectionReason.INVALID_JSON);
        }
        assertThat(reason(topic, new byte[]{'{', (byte) 0xC3, (byte) 0x28, '}'})).isEqualTo(RejectionReason.INVALID_JSON);
    }

    @Test
    void rejectsMissingOrInvalidEnvelopeFields() {
        String topic = "vending/" + CODE + "/telemetry";
        String good = "\"messageId\":\"m-1\",\"machineCode\":\"" + CODE + "\",\"payload\":{}";
        for (String body : new String[]{
                "{" + good + "}", "{\"schemaVersion\":\"1\"," + good + "}", "{\"schemaVersion\":1.5," + good + "}", "{\"schemaVersion\":null," + good + "}",
                "{\"schemaVersion\":1,\"machineCode\":\"" + CODE + "\",\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":\"\",\"machineCode\":\"" + CODE + "\",\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":\"   \",\"machineCode\":\"" + CODE + "\",\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":\"has space\",\"machineCode\":\"" + CODE + "\",\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":\"" + "a".repeat(65) + "\",\"machineCode\":\"" + CODE + "\",\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":7,\"machineCode\":\"" + CODE + "\",\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":\"m\\u0000x\",\"machineCode\":\"" + CODE + "\",\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":42,\"payload\":{}}",
                "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":\"" + CODE + "\"}",
                "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":\"" + CODE + "\",\"payload\":null}",
                "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":\"" + CODE + "\",\"payload\":[1]}",
                "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":\"" + CODE + "\",\"payload\":\"{}\"}"}) {
            assertThat(reason(topic, body)).as(body).isEqualTo(RejectionReason.INVALID_ENVELOPE);
        }
        assertThat(parse(topic, "{\"schemaVersion\":1,\"messageId\":\"" + "a".repeat(64) + "\",\"machineCode\":\"" + CODE + "\",\"payload\":{}}")
                .messageId()).hasSize(64);
    }

    @Test
    void rejectsUnsupportedSchemaVersions() {
        String topic = "vending/" + CODE + "/status";
        for (String version : new String[]{"0", "2", "-1", "99"})
            assertThat(reason(topic, envelope("").replace("\"schemaVersion\":1", "\"schemaVersion\":" + version))).isEqualTo(RejectionReason.UNSUPPORTED_SCHEMA_VERSION);
    }

    @Test
    void rejectsTopicAndEnvelopeMachineCodeMismatch() {
        for (String other : new String[]{"FV-HCM-002", "fv-hcm-001", "FV-HCM-001 ", ""}) {
            var error = org.assertj.core.api.Assertions.catchThrowableOfType(MachineMessageRejectedException.class,
                    () -> parse("vending/" + CODE + "/events", envelope("").replace("\"machineCode\":\"" + CODE + "\"", "\"machineCode\":\"" + other + "\"")));
            assertThat(error.reason()).isEqualTo(RejectionReason.MACHINE_CODE_MISMATCH);
            assertThat(error.machineCode()).isEqualTo(CODE);
            assertThat(error.messageId()).isEqualTo("m-1");
        }
    }

    @Test
    void sentAtIsOptionalButMustBeAnIsoInstantWhenPresent() {
        String topic = "vending/" + CODE + "/telemetry";
        assertThat(parse(topic, envelope("")).sentAt()).isNull();
        assertThat(parse(topic, envelope(",\"sentAt\":null")).sentAt()).isNull();
        assertThat(parse(topic, envelope(",\"sentAt\":\"2026-10-20T07:05:00+07:00\"")).sentAt()).isEqualTo(Instant.parse("2026-10-20T00:05:00Z"));
        for (String bad : new String[]{"\"yesterday\"", "\"2026-10-20\"", "\"2026-10-20 00:05:00\"", "1760918700", "true"})
            assertThat(reason(topic, envelope(",\"sentAt\":" + bad))).as(bad).isEqualTo(RejectionReason.INVALID_ENVELOPE);
    }

    @Test
    void unknownEnvelopeFieldsAreIgnoredAndRejectionsNeverQuoteThePayload() {
        assertThat(parse("vending/" + CODE + "/telemetry", envelope(",\"futureField\":true")).messageId()).isEqualTo("m-1");
        var error = org.assertj.core.api.Assertions.catchThrowableOfType(MachineMessageRejectedException.class,
                () -> parse("vending/" + CODE + "/telemetry", "{\"schemaVersion\":1,\"messageId\":\"m-1\",\"machineCode\":\"" + CODE + "\",\"payload\":\"SECRET-PAYLOAD\"}"));
        assertThat(error.getMessage()).doesNotContain("SECRET-PAYLOAD");
        assertThat(error.getStackTrace()).isEmpty();
    }
}
