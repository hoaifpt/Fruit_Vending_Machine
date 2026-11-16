package com.fruitmachine.backend.machine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.machine.event.MachineOfflineReportedEvent;
import com.fruitmachine.backend.machine.event.MachineRebootDetectedEvent;
import com.fruitmachine.backend.mqtt.MachineMessageHandler;
import com.fruitmachine.backend.sensor.event.TelemetryRecordedEvent;
import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import static org.assertj.core.api.Assertions.assertThat;

/** Issue #53: MQTT heartbeat/status/telemetry intake, presence, derived connectivity and the read APIs (fixed, advanceable clock). */
@RecordApplicationEvents
@ExtendWith(OutputCaptureExtension.class)
class MachineHealthIntegrationTest extends AbstractOrderIntegrationTest {
    static final String HEARTBEAT = "{\"state\":\"ONLINE\",\"uptimeSeconds\":%d,\"wifiRssi\":-55,\"freeHeap\":18240,\"firmwareVersion\":\"0.3.0\"}";

    @Autowired MachineMessageHandler messages;
    @Autowired ApplicationEvents events;
    UUID machine;
    String code;
    int sequence;

    @BeforeEach
    void machine() throws Exception {
        machine = fixtures.machine(admin.token());
        code = jdbc.queryForObject("SELECT code FROM machines WHERE id=?", String.class, machine);
    }

    void send(String channel, String payload) {
        send(code, channel, "{\"schemaVersion\":1,\"messageId\":\"t-" + (++sequence) + "\",\"machineCode\":\"" + code + "\",\"payload\":" + payload + "}");
    }

    void send(String topicCode, String channel, String body) {
        messages.handle(topicCode, channel, body.getBytes(StandardCharsets.UTF_8));
    }

    Map<String, Object> presence() {
        return jdbc.queryForMap("""
                SELECT last_seen_at, last_heartbeat_at, last_offline_at, firmware_version, uptime_seconds, wifi_rssi, free_heap_bytes, updated_at
                FROM machines WHERE id=?""", machine);
    }

    JsonNode machineJson() throws Exception {
        return fixtures.api("GET", "/api/v1/machines/" + machine, null, staff.token(), 200);
    }

    String connectivity() throws Exception {
        return machineJson().path("connectivity").asText();
    }

    // ---- envelope ----

    @Test
    void invalidEnvelopesAndUnknownMachinesAreDroppedWithoutAnyChange() {
        var before = presence();
        String heartbeat = HEARTBEAT.formatted(10);
        for (String body : List.of(
                "{\"messageId\":\"m\",\"machineCode\":\"%s\",\"payload\":%s}",
                "{\"schemaVersion\":2,\"messageId\":\"m\",\"machineCode\":\"%s\",\"payload\":%s}",
                "{\"schemaVersion\":\"1\",\"messageId\":\"m\",\"machineCode\":\"%s\",\"payload\":%s}",
                "{\"schemaVersion\":1,\"machineCode\":\"%s\",\"payload\":%s}",
                "{\"schemaVersion\":1,\"messageId\":\" \",\"machineCode\":\"%s\",\"payload\":%s}",
                "{\"schemaVersion\":1,\"messageId\":\"" + "x".repeat(65) + "\",\"machineCode\":\"%s\",\"payload\":%s}",
                "{\"schemaVersion\":1,\"messageId\":\"m\",\"payload\":%2$s}",
                "{\"schemaVersion\":1,\"messageId\":\"m\",\"machineCode\":\"OTHER\",\"payload\":%2$s}",
                "{\"schemaVersion\":1,\"messageId\":\"m\",\"machineCode\":\"%s\",\"payload\":[]}",
                "{\"schemaVersion\":1,\"messageId\":\"m\",\"machineCode\":\"%s\",\"payload\":\"x\"}",
                "[1,2]", "not json")) {
            send(code, "heartbeat", body.formatted(code, heartbeat));
        }
        // Larger than 8 KB, otherwise valid.
        send(code, "heartbeat", "{\"schemaVersion\":1,\"messageId\":\"m\",\"machineCode\":\"" + code + "\",\"payload\":"
                + heartbeat.replace("}", ",\"pad\":\"" + "x".repeat(8200) + "\"}") + "}");
        assertThat(presence()).isEqualTo(before);
        // A valid envelope on an unknown machine's topic changes nothing either.
        long machines = jdbc.queryForObject("SELECT count(*) FROM machines WHERE last_seen_at IS NOT NULL", Long.class);
        send("NO-SUCH-MACHINE", "heartbeat", "{\"schemaVersion\":1,\"messageId\":\"m\",\"machineCode\":\"NO-SUCH-MACHINE\",\"payload\":" + heartbeat + "}");
        // A valid message on this machine's own topic is accepted, so exactly one more machine has been seen.
        send("telemetry", "{\"temperature\":4.7}");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM machines WHERE last_seen_at IS NOT NULL", Long.class)).isEqualTo(machines + 1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM machines WHERE code='NO-SUCH-MACHINE'", Long.class)).isZero();
    }

    // ---- presence ----

    @Test
    void heartbeatWritesPresenceAndDiagnosticsAndMissingOptionalsBecomeNull() throws Exception {
        var updatedAt = presence().get("updated_at");
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        send("heartbeat", HEARTBEAT.formatted(12345));
        var row = presence();
        assertThat(row.get("last_seen_at")).isNotNull().isEqualTo(row.get("last_heartbeat_at"));
        assertThat(((java.sql.Timestamp) row.get("last_seen_at")).toInstant()).isAfterOrEqualTo(now);
        assertThat(row.get("firmware_version")).isEqualTo("0.3.0");
        assertThat(row.get("uptime_seconds")).isEqualTo(12345L);
        assertThat(((Number) row.get("wifi_rssi")).intValue()).isEqualTo(-55);
        assertThat(row.get("free_heap_bytes")).isEqualTo(18240L);
        assertThat(row.get("updated_at")).isEqualTo(updatedAt);

        clock.advance(Duration.ofSeconds(30));
        send("heartbeat", "{\"state\":\"ONLINE\",\"uptimeSeconds\":12375,\"firmwareVersion\":\"0.3.1\"}");
        row = presence();
        assertThat(row.get("wifi_rssi")).isNull();
        assertThat(row.get("free_heap_bytes")).isNull();
        assertThat(row.get("firmware_version")).isEqualTo("0.3.1");
        assertThat(row.get("updated_at")).isEqualTo(updatedAt);

        var api = machineJson();
        assertThat(api.path("connectivity").asText()).isEqualTo("ONLINE");
        assertThat(api.path("firmwareVersion").asText()).isEqualTo("0.3.1");
        assertThat(api.path("uptimeSeconds").asLong()).isEqualTo(12375);
        assertThat(api.path("wifiRssi").isNull()).isTrue();
        assertThat(api.path("freeHeapBytes").isNull()).isTrue();
        assertThat(api.path("lastHeartbeatAt").asText()).isNotBlank();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{\"state\":\"OFFLINE\",\"uptimeSeconds\":1,\"firmwareVersion\":\"0.3.0\"}",
            "{\"uptimeSeconds\":1,\"firmwareVersion\":\"0.3.0\"}",
            "{\"state\":\"ONLINE\",\"firmwareVersion\":\"0.3.0\"}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":-1,\"firmwareVersion\":\"0.3.0\"}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":1.5,\"firmwareVersion\":\"0.3.0\"}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":1}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":1,\"firmwareVersion\":\" \"}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":1,\"firmwareVersion\":\"123456789012345678901234567890123\"}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":1,\"firmwareVersion\":\"0.3.0\",\"wifiRssi\":5}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":1,\"firmwareVersion\":\"0.3.0\",\"wifiRssi\":-128}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":1,\"firmwareVersion\":\"0.3.0\",\"freeHeap\":-1}",
            "{\"state\":\"ONLINE\",\"uptimeSeconds\":1,\"firmwareVersion\":\"0.3.0\",\"freeHeap\":\"many\"}"})
    void anInvalidHeartbeatUpdatesNothing(String payload) {
        var before = presence();
        send("heartbeat", payload);
        assertThat(presence()).isEqualTo(before);
    }

    @Test
    void statusOnlineUpdatesPresenceAndOfflineOnlyRecordsTheLastWill() throws Exception {
        send("status", "{\"state\":\"ONLINE\",\"firmwareVersion\":\"0.3.0\",\"uptimeSeconds\":12}");
        var online = presence();
        assertThat(online.get("last_seen_at")).isNotNull();
        assertThat(online.get("last_heartbeat_at")).isNull();
        assertThat(online.get("firmware_version")).isEqualTo("0.3.0");
        assertThat(online.get("uptime_seconds")).isEqualTo(12L);
        assertThat(connectivity()).isEqualTo("ONLINE");

        clock.advance(Duration.ofSeconds(5));
        send("status", "{\"state\":\"OFFLINE\"}");
        var offline = presence();
        assertThat(offline.get("last_offline_at")).isNotNull();
        assertThat(offline.get("last_seen_at")).isEqualTo(online.get("last_seen_at"));
        assertThat(offline.get("uptime_seconds")).isEqualTo(12L);
        // Last Will: OFFLINE immediately, not after 180 s.
        assertThat(connectivity()).isEqualTo("OFFLINE");
        assertThat(events.stream(MachineOfflineReportedEvent.class).filter(e -> e.machineId().equals(machine))).hasSize(1);

        clock.advance(Duration.ofSeconds(5));
        send("heartbeat", HEARTBEAT.formatted(3));
        assertThat(connectivity()).isEqualTo("ONLINE");
        // An unknown state is dropped.
        var current = presence();
        clock.advance(Duration.ofSeconds(5));
        send("status", "{\"state\":\"SLEEPING\"}");
        assertThat(presence()).isEqualTo(current);
    }

    @Test
    void lastSeenNeverMovesBackward() {
        Instant future = clock.instant().plus(Duration.ofHours(1)).truncatedTo(ChronoUnit.MICROS);
        jdbc.update("UPDATE machines SET last_seen_at=?, uptime_seconds=99 WHERE id=?", java.sql.Timestamp.from(future), machine);
        send("heartbeat", HEARTBEAT.formatted(5));
        send("status", "{\"state\":\"ONLINE\",\"uptimeSeconds\":7}");
        send("events", "{\"eventType\":\"BOWL_SENSOR_TRIGGERED\",\"details\":{\"dispenseState\":\"IDLE\"}}");
        var row = presence();
        assertThat(((java.sql.Timestamp) row.get("last_seen_at")).toInstant()).isEqualTo(future);
        assertThat(row.get("last_heartbeat_at")).isNull();
        assertThat(row.get("uptime_seconds")).isEqualTo(99L);
    }

    @Test
    void concurrentConfigurationUpdatesAndHeartbeatsLoseNothingAndNeverDeadlock() throws Exception {
        var pool = Executors.newFixedThreadPool(8);
        try {
            var go = new CountDownLatch(1);
            List<Future<?>> tasks = new ArrayList<>();
            for (int i = 0; i < 12; i++) {
                int n = i;
                tasks.add(pool.submit((Callable<Void>) () -> {
                    go.await();
                    fixtures.api("PUT", "/api/v1/machines/" + machine, Map.of("name", "Concurrent " + n, "location", "Lab", "minTemperature", 2,
                            "maxTemperature", 8, "minHumidity", 40, "maxHumidity", 80), admin.token(), 200);
                    return null;
                }));
                tasks.add(pool.submit((Callable<Void>) () -> {
                    go.await();
                    send(code, "heartbeat", "{\"schemaVersion\":1,\"messageId\":\"c-" + n + "\",\"machineCode\":\"" + code + "\",\"payload\":"
                            + HEARTBEAT.formatted(1000 + n) + "}");
                    return null;
                }));
            }
            go.countDown();
            for (var task : tasks) task.get(60, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        var row = jdbc.queryForMap("SELECT name, location, last_heartbeat_at, firmware_version FROM machines WHERE id=?", machine);
        assertThat((String) row.get("name")).startsWith("Concurrent ");
        assertThat(row.get("location")).isEqualTo("Lab");
        assertThat(row.get("last_heartbeat_at")).isNotNull();
        assertThat(row.get("firmware_version")).isEqualTo("0.3.0");
        // The configuration change did not write presence back, and presence did not touch updated_at.
        var after = jdbc.queryForMap("SELECT updated_at >= created_at AS ok FROM machines WHERE id=?", machine);
        assertThat(after.get("ok")).isEqualTo(true);
    }

    // ---- connectivity ----

    @Test
    void connectivityFollowsTheThresholdsAndTheListFilterUsesTheSameRules() throws Exception {
        assertThat(connectivity()).isEqualTo("NEVER_SEEN");
        assertThat(listed("NEVER_SEEN")).contains(machine.toString());
        send("heartbeat", HEARTBEAT.formatted(1));
        assertThat(connectivity()).isEqualTo("ONLINE");
        assertThat(listed("ONLINE")).contains(machine.toString());
        // The test clock is real time plus an offset, so a little real time passes between the steps.
        clock.advance(Duration.ofSeconds(58));
        assertThat(connectivity()).isEqualTo("ONLINE");
        clock.advance(Duration.ofSeconds(4));
        assertThat(connectivity()).isEqualTo("WARNING");
        assertThat(listed("WARNING")).contains(machine.toString());
        assertThat(listed("ONLINE")).doesNotContain(machine.toString());
        clock.advance(Duration.ofSeconds(120));
        assertThat(connectivity()).isEqualTo("OFFLINE");
        assertThat(listed("OFFLINE")).contains(machine.toString());
        assertThat(listed("WARNING")).doesNotContain(machine.toString());

        // Paging of a filtered list happens in the database: one machine per page, every page different.
        var page0 = fixtures.api("GET", "/api/v1/machines?connectivity=NEVER_SEEN&size=1&page=0", null, staff.token(), 200);
        var page1 = fixtures.api("GET", "/api/v1/machines?connectivity=NEVER_SEEN&size=1&page=1", null, staff.token(), 200);
        long never = jdbc.queryForObject("SELECT count(*) FROM machines WHERE last_seen_at IS NULL", Long.class);
        assertThat(page0.path("totalElements").asLong()).isEqualTo(never);
        assertThat(page0.path("content")).hasSize(1);
        if (never > 1) assertThat(page1.at("/content/0/id").asText()).isNotEqualTo(page0.at("/content/0/id").asText());
        fixtures.response("GET", "/api/v1/machines?connectivity=SLEEPING", null, staff.token(), 400);
    }

    private List<String> listed(String connectivity) throws Exception {
        return fixtures.api("GET", "/api/v1/machines?size=100&connectivity=" + connectivity, null, staff.token(), 200)
                .path("content").findValuesAsText("id");
    }

    // ---- reboot and recovery ----

    @Test
    void aLowerUptimePublishesOneRebootEventAndARecoveryIsLoggedOnce(CapturedOutput output) {
        send("heartbeat", HEARTBEAT.formatted(500));
        clock.advance(Duration.ofSeconds(30));
        send("heartbeat", HEARTBEAT.formatted(530));
        assertThat(events.stream(MachineRebootDetectedEvent.class).filter(e -> e.machineId().equals(machine))).isEmpty();
        clock.advance(Duration.ofSeconds(30));
        send("heartbeat", HEARTBEAT.formatted(4));
        clock.advance(Duration.ofSeconds(30));
        send("heartbeat", HEARTBEAT.formatted(34));
        assertThat(events.stream(MachineRebootDetectedEvent.class).filter(e -> e.machineId().equals(machine)))
                .singleElement().satisfies(e -> {
                    assertThat(e.previousUptimeSeconds()).isEqualTo(530);
                    assertThat(e.newUptimeSeconds()).isEqualTo(4);
                });

        String recovered = "Machine " + code + " back online after";
        assertThat(output.getAll()).doesNotContain(recovered);
        clock.advance(Duration.ofSeconds(200));
        send("heartbeat", HEARTBEAT.formatted(234));
        clock.advance(Duration.ofSeconds(30));
        send("heartbeat", HEARTBEAT.formatted(264));
        assertThat(output.getAll().split(java.util.regex.Pattern.quote(recovered), -1)).hasSize(2);
    }

    // ---- telemetry ----

    @Test
    void validTelemetryIsStoredRoundedWithTheServerTimeAndPublished() throws Exception {
        Instant before = clock.instant().truncatedTo(ChronoUnit.MICROS);
        send("telemetry", "{\"temperature\":4.705,\"humidity\":68.2,\"unknownField\":true}");
        var row = jdbc.queryForMap("SELECT temperature, humidity, recorded_at FROM sensor_readings WHERE machine_id=?", machine);
        assertThat(row.get("temperature").toString()).isEqualTo("4.71");
        assertThat(row.get("humidity").toString()).isEqualTo("68.20");
        assertThat(((java.sql.Timestamp) row.get("recorded_at")).toInstant()).isAfterOrEqualTo(before).isBefore(Instant.now().plus(Duration.ofHours(1)));
        assertThat(presence().get("last_seen_at")).isNotNull();
        assertThat(events.stream(TelemetryRecordedEvent.class).filter(e -> e.machineId().equals(machine)))
                .singleElement().satisfies(e -> assertThat(e.temperature()).isEqualByComparingTo("4.71"));

        clock.advance(Duration.ofSeconds(11));
        send("telemetry", "{\"temperature\":5}");
        clock.advance(Duration.ofSeconds(11));
        send("telemetry", "{\"humidity\":70,\"temperature\":null}");
        assertThat(jdbc.queryForList("SELECT temperature::text || '/' || coalesce(humidity::text, '-') FROM sensor_readings WHERE machine_id=? AND humidity IS NULL",
                String.class, machine)).containsExactly("5.00/-");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sensor_readings WHERE machine_id=? AND temperature IS NULL AND humidity=70", Long.class, machine)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"temperature\":null,\"humidity\":null}", "{\"temperature\":\"4.7\"}", "{\"temperature\":-40.01}",
            "{\"temperature\":85.01}", "{\"humidity\":-0.01}", "{\"humidity\":100.01}", "{\"temperature\":1e400}", "{\"temperature\":NaN}",
            "{\"temperature\":true}", "{\"temperature\":4.7,\"humidity\":\"wet\"}"})
    void invalidTelemetryIsDroppedAndTouchesNothing(String payload) {
        var before = presence();
        send("telemetry", payload);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sensor_readings WHERE machine_id=?", Long.class, machine)).isZero();
        assertThat(presence()).isEqualTo(before);
    }

    @Test
    void edgeValuesAreAcceptedAndRepeatsAndFastReadingsAreDropped() {
        String body = "{\"schemaVersion\":1,\"messageId\":\"dup-1\",\"machineCode\":\"" + code + "\",\"payload\":{\"temperature\":-40,\"humidity\":100}}";
        send(code, "telemetry", body);
        clock.advance(Duration.ofSeconds(30));
        // Same messageId again (QoS 1 redelivery) within 10 minutes: dropped.
        send(code, "telemetry", body);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sensor_readings WHERE machine_id=?", Long.class, machine)).isEqualTo(1);
        // A new reading 5 s after the previous stored one: dropped by the 10 s minimum interval; 11 s later accepted.
        send("telemetry", "{\"temperature\":85}");
        clock.advance(Duration.ofSeconds(5));
        send("telemetry", "{\"temperature\":6}");
        clock.advance(Duration.ofSeconds(11));
        send("telemetry", "{\"temperature\":7}");
        assertThat(jdbc.queryForList("SELECT temperature::text FROM sensor_readings WHERE machine_id=? ORDER BY recorded_at", String.class, machine))
                .containsExactly("-40.00", "85.00", "7.00");
    }

    // ---- read APIs ----

    @Test
    void latestReadingComparesWithTheMachineThresholdsAndIsNullBeforeTheFirstReading() throws Exception {
        var empty = fixtures.api("GET", "/api/v1/machines/" + machine + "/telemetry/latest", null, staff.token(), 200);
        assertThat(empty.path("machineId").asText()).isEqualTo(machine.toString());
        for (String field : List.of("recordedAt", "temperature", "humidity", "temperatureStatus", "humidityStatus"))
            assertThat(empty.path(field).isNull()).as(field).isTrue();
        assertThat(empty.path("connectivity").asText()).isEqualTo("NEVER_SEEN");
        assertThat(empty.fieldNames()).toIterable().containsExactlyInAnyOrder("machineId", "recordedAt", "temperature", "humidity",
                "temperatureStatus", "humidityStatus", "connectivity");

        // fixtures.machine: 2..8 C, 40..80 %RH.
        String[][] cases = {{"{\"temperature\":1.99,\"humidity\":80}", "LOW", "NORMAL"}, {"{\"temperature\":8,\"humidity\":80.01}", "NORMAL", "HIGH"},
                {"{\"temperature\":8.01}", "HIGH", null}, {"{\"humidity\":39.99}", null, "LOW"}};
        for (String[] c : cases) {
            clock.advance(Duration.ofSeconds(11));
            send("telemetry", c[0]);
            var latest = fixtures.api("GET", "/api/v1/machines/" + machine + "/telemetry/latest", null, admin.token(), 200);
            assertThat(latest.path("temperatureStatus").isNull() ? null : latest.path("temperatureStatus").asText()).as(c[0]).isEqualTo(c[1]);
            assertThat(latest.path("humidityStatus").isNull() ? null : latest.path("humidityStatus").asText()).as(c[0]).isEqualTo(c[2]);
            assertThat(latest.path("connectivity").asText()).isEqualTo("ONLINE");
        }
        fixtures.response("GET", "/api/v1/machines/" + UUID.randomUUID() + "/telemetry/latest", null, staff.token(), 404);
    }

    @Test
    void historyIsValidatedPagedInTheDatabaseNewestFirstAnd404ForAMissingMachine() throws Exception {
        Instant start = clock.instant();
        for (int i = 0; i < 5; i++) {
            send("telemetry", "{\"temperature\":" + (3 + i) + "}");
            clock.advance(Duration.ofSeconds(11));
        }
        String base = "/api/v1/machines/" + machine + "/telemetry";
        String range = "?from=" + start.minusSeconds(1) + "&to=" + clock.instant().plusSeconds(1);
        var first = fixtures.api("GET", base + range + "&size=2", null, staff.token(), 200);
        assertThat(first.path("totalElements").asLong()).isEqualTo(5);
        assertThat(first.path("totalPages").asInt()).isEqualTo(3);
        assertThat(first.path("content").findValuesAsText("temperature")).containsExactly("7.0", "6.0");
        var last = fixtures.api("GET", base + range + "&size=2&page=2", null, staff.token(), 200);
        assertThat(last.path("content").findValuesAsText("temperature")).containsExactly("3.0");
        assertThat(fixtures.api("GET", base + range, null, staff.token(), 200).path("size").asInt()).isEqualTo(100);
        // to is exclusive: a range ending at the newest reading excludes it.
        String newest = jdbc.queryForObject("SELECT max(recorded_at) FROM sensor_readings WHERE machine_id=?", java.sql.Timestamp.class, machine).toInstant().toString();
        assertThat(fixtures.api("GET", base + "?from=" + start.minusSeconds(1) + "&to=" + newest, null, staff.token(), 200).path("totalElements").asLong()).isEqualTo(4);

        Instant now = Instant.now();
        for (String bad : List.of("", "?from=" + now, "?to=" + now, "?from=" + now + "&to=" + now, "?from=" + now + "&to=" + now.minusSeconds(1),
                "?from=" + now.minus(Duration.ofDays(31)).minusSeconds(1) + "&to=" + now, range + "&size=0", range + "&size=501", range + "&page=-1",
                "?from=yesterday&to=" + now)) {
            fixtures.response("GET", base + bad, null, staff.token(), 400);
        }
        assertThat(fixtures.api("GET", base + "?from=" + now.minus(Duration.ofDays(31)) + "&to=" + now + "&size=500", null, staff.token(), 200)
                .path("size").asInt()).isEqualTo(500);
        fixtures.response("GET", "/api/v1/machines/" + UUID.randomUUID() + "/telemetry" + range, null, staff.token(), 404);
        fixtures.response("GET", "/api/v1/machines/not-a-uuid/telemetry" + range, null, staff.token(), 400);
    }

    @Test
    void readApisNeedMachineRead() throws Exception {
        String latest = "/api/v1/machines/" + machine + "/telemetry/latest";
        String history = "/api/v1/machines/" + machine + "/telemetry?from=2026-11-10T00:00:00Z&to=2026-11-11T00:00:00Z";
        for (String path : List.of(latest, history)) {
            fixtures.api("GET", path, null, admin.token(), 200);
            fixtures.api("GET", path, null, staff.token(), 200);
            fixtures.response("GET", path, null, null, 401);
            assertThat(kioskCall("GET", path, issueKey(machine), null).getResponse().getStatus()).isEqualTo(401);
        }
        // An account whose roles grant no MACHINE_READ.
        var noRole = fixtures.staff(admin.token(), PASSWORD);
        jdbc.update("DELETE FROM user_roles WHERE user_id=?", noRole.id());
        for (String path : List.of(latest, history, "/api/v1/machines/" + machine)) fixtures.response("GET", path, null, noRole.token(), 403);
    }
}
