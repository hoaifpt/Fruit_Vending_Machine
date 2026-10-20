package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.mqtt.inbound.MachineMessageDispatcher;
import com.fruitmachine.backend.mqtt.inbound.MachineMessageParser;
import com.fruitmachine.backend.mqtt.inbound.MachineResolver;
import com.fruitmachine.backend.mqtt.inbound.MqttInboundAdapter;
import com.fruitmachine.backend.mqtt.inbound.RejectionLogLimiter;
import com.fruitmachine.backend.mqtt.inbound.RejectionReason;
import com.fruitmachine.backend.mqtt.message.MachineChannel;
import com.fruitmachine.backend.mqtt.message.MachineMessage;
import com.fruitmachine.backend.mqtt.message.MachineMessageHandler;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(OutputCaptureExtension.class)
class MachineMessageDispatchTest {
    static final Instant NOW = Instant.parse("2026-10-20T01:00:00Z");
    static final UUID MACHINE = UUID.fromString("9b1e0000-0000-4000-8000-000000000001");

    record Recording(MachineChannel channel, List<MachineMessage> seen, boolean fail) implements MachineMessageHandler {
        @Override
        public void handle(MachineMessage message) {
            if (fail && message.messageId().startsWith("boom")) throw new IllegalStateException("handler failed with payload " + message.payload());
            seen.add(message);
        }
    }

    MeterRegistry registry;
    MqttMetrics metrics;
    MachineRepository machines;
    List<MachineMessage> telemetry, events;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        var factory = new StaticListableBeanFactory();
        factory.addBean("registry", registry);
        metrics = new MqttMetrics(factory.getBeanProvider(MeterRegistry.class));
        machines = mock(MachineRepository.class);
        when(machines.findIdByCode(anyString())).thenReturn(Optional.empty());
        when(machines.findIdByCode("FV-HCM-001")).thenReturn(Optional.of(MACHINE));
        telemetry = new ArrayList<>();
        events = new ArrayList<>();
    }

    MqttInboundAdapter adapter(MachineMessageHandler... handlers) {
        Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
        var parser = new MachineMessageParser(new ObjectMapper(), MachineMessageParserTest.properties(8192), clock);
        return new MqttInboundAdapter(parser, new MachineResolver(machines), new MachineMessageDispatcher(List.of(handlers), metrics),
                new RejectionLogLimiter(clock), metrics);
    }

    static byte[] body(String code, String messageId) {
        return ("{\"schemaVersion\":1,\"messageId\":\"" + messageId + "\",\"machineCode\":\"" + code + "\",\"payload\":{\"secretValue\":\"P-123\"}}")
                .getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void routesToTheHandlerOfTheChannelWithTheResolvedMachine() {
        var inbound = adapter(new Recording(MachineChannel.TELEMETRY, telemetry, false), new Recording(MachineChannel.EVENT, events, false));
        inbound.onMessage("vending/FV-HCM-001/telemetry", body("FV-HCM-001", "t-1"));
        inbound.onMessage("vending/FV-HCM-001/events", body("FV-HCM-001", "e-1"));
        assertThat(telemetry).singleElement().satisfies(m -> {
            assertThat(m.machineId()).isEqualTo(MACHINE);
            assertThat(m.machineCode()).isEqualTo("FV-HCM-001");
            assertThat(m.channel()).isEqualTo(MachineChannel.TELEMETRY);
            assertThat(m.messageId()).isEqualTo("t-1");
            assertThat(m.receivedAt()).isEqualTo(NOW);
            assertThat(m.sentAt()).isNull();
        });
        assertThat(events).singleElement().satisfies(m -> assertThat(m.channel()).isEqualTo(MachineChannel.EVENT));
        assertThat(metrics.count(MqttMetrics.RECEIVED)).isEqualTo(2);
        assertThat(metrics.count(MqttMetrics.ACCEPTED)).isEqualTo(2);
    }

    @Test
    void missingHandlerDropsTheMessageWithoutException(CapturedOutput output) {
        var inbound = adapter(new Recording(MachineChannel.TELEMETRY, telemetry, false));
        assertThatNoException().isThrownBy(() -> inbound.onMessage("vending/FV-HCM-001/status", body("FV-HCM-001", "s-1")));
        assertThat(metrics.count(MqttMetrics.UNHANDLED, "channel", "status")).isEqualTo(1);
        assertThat(telemetry).isEmpty();
        assertThat(output).doesNotContain("WARN", "ERROR");
    }

    @Test
    void handlerExceptionIsCaughtAndTheNextMessageIsStillProcessed(CapturedOutput output) {
        var inbound = adapter(new Recording(MachineChannel.TELEMETRY, telemetry, true));
        assertThatNoException().isThrownBy(() -> inbound.onMessage("vending/FV-HCM-001/telemetry", body("FV-HCM-001", "boom-1")));
        inbound.onMessage("vending/FV-HCM-001/telemetry", body("FV-HCM-001", "ok-2"));
        assertThat(telemetry).extracting(MachineMessage::messageId).containsExactly("ok-2");
        assertThat(metrics.count(MqttMetrics.HANDLER_ERRORS, "channel", "telemetry")).isEqualTo(1);
        assertThat(output).contains("ERROR", "FV-HCM-001", "boom-1", "IllegalStateException").doesNotContain("P-123", "secretValue");
    }

    @Test
    void unknownMachineCodeIsDroppedAndCounted(CapturedOutput output) {
        var inbound = adapter(new Recording(MachineChannel.TELEMETRY, telemetry, false));
        inbound.onMessage("vending/FV-NOPE-404/telemetry", body("FV-NOPE-404", "u-1"));
        assertThat(telemetry).isEmpty();
        assertThat(metrics.count(MqttMetrics.REJECTED, "reason", RejectionReason.UNKNOWN_MACHINE.name())).isEqualTo(1);
        assertThat(output).contains("UNKNOWN_MACHINE", "FV-NOPE-404", "u-1").doesNotContain("P-123");
    }

    @Test
    void invalidMessagesNeverThrowAndRepeatedWarningsAreRateLimited(CapturedOutput output) {
        var inbound = adapter(new Recording(MachineChannel.TELEMETRY, telemetry, false));
        for (int i = 0; i < 50; i++) inbound.onMessage("vending/FV-HCM-001/telemetry", "not json".getBytes(StandardCharsets.UTF_8));
        inbound.onMessage("bad\u0000topic\nINJECTED", body("FV-HCM-001", "x"));
        inbound.onMessage("vending/FV-HCM-001/telemetry", body("FV-HCM-001", "after"));
        assertThat(telemetry).extracting(MachineMessage::messageId).containsExactly("after");
        assertThat(metrics.count(MqttMetrics.REJECTED, "reason", "INVALID_JSON")).isEqualTo(50);
        assertThat(metrics.count(MqttMetrics.REJECTED, "reason", "INVALID_TOPIC")).isEqualTo(1);
        assertThat(output.getOut().split("reason=INVALID_JSON", -1)).hasSize(2);
        assertThat(output).contains("bad?topic?INJECTED").doesNotContain("not json");
    }

    @Test
    void rateLimitedWarningReportsSuppressedCountAfterTheWindow(CapturedOutput output) {
        var clock = new java.util.concurrent.atomic.AtomicReference<>(NOW);
        Clock moving = new Clock() {
            @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId zone) { return this; }
            @Override public Instant instant() { return clock.get(); }
        };
        var limiter = new RejectionLogLimiter(moving);
        var rejection = new com.fruitmachine.backend.mqtt.inbound.MachineMessageRejectedException(RejectionReason.INVALID_ENVELOPE, "x", "FV-HCM-001", "m");
        assertThat(limiter.warn("vending/FV-HCM-001/telemetry", rejection)).isTrue();
        assertThat(limiter.warn("vending/FV-HCM-001/telemetry", rejection)).isFalse();
        assertThat(limiter.warn("vending/FV-HCM-001/telemetry", rejection)).isFalse();
        clock.set(NOW.plusSeconds(61));
        assertThat(limiter.warn("vending/FV-HCM-001/telemetry", rejection)).isTrue();
        assertThat(output).contains("2 identical warnings suppressed");
    }

    @Test
    void twoHandlersForOneChannelAreAConfigurationError() {
        assertThatThrownBy(() -> new MachineMessageDispatcher(List.of(new Recording(MachineChannel.STATUS, telemetry, false),
                new Recording(MachineChannel.STATUS, events, false)), metrics)).isInstanceOf(IllegalStateException.class).hasMessageContaining("STATUS");
    }
}
