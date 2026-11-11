package com.fruitmachine.backend.machine.service;

import com.fruitmachine.backend.machine.event.MachineOfflineReportedEvent;
import com.fruitmachine.backend.machine.event.MachineRebootDetectedEvent;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Presence and diagnostics of a machine, written with one conditional UPDATE per message: forward-only (an older message never
 * moves last_seen_at back), no entity load, and machines.updated_at untouched (it tracks configuration edits). The UPDATE locks
 * only the machine row for the rest of the short transaction, so it serializes with configuration updates of that row without
 * deadlocks or lost updates: the two write disjoint columns (Machine maps presence columns as not updatable).
 * The previous values come back through PostgreSQL 18 {@code RETURNING old.*} for reboot detection and the recovery log.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MachinePresenceService {
    /** Diagnostics of a valid heartbeat (contract §5.2); wifiRssi and freeHeap may be null, never defaulted to 0. */
    public record Heartbeat(long uptimeSeconds, String firmwareVersion, Short wifiRssi, Long freeHeapBytes) { }

    private record Previous(Instant lastSeenAt, Instant lastOfflineAt, Long uptimeSeconds) { }

    private static final String RETURNING = """
             WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)
            RETURNING old.last_seen_at, old.last_offline_at, old.uptime_seconds""";

    private final JdbcTemplate jdbc;
    private final ConnectivityEvaluator connectivity;
    private final ApplicationEventPublisher events;

    /** Any valid message other than status OFFLINE: the machine was heard from. */
    @Transactional
    public void touch(UUID machineId, String machineCode, Instant now) {
        after(machineId, machineCode, now, null, update("UPDATE machines SET last_seen_at = ?" + RETURNING, ts(now), machineId, ts(now)));
    }

    /** Valid heartbeat: last_seen_at, last_heartbeat_at and every diagnostic field in one statement; absent optionals become NULL. */
    @Transactional
    public void heartbeat(UUID machineId, String machineCode, Heartbeat beat, Instant now) {
        after(machineId, machineCode, now, beat.uptimeSeconds(), update("""
                UPDATE machines SET last_seen_at = ?, last_heartbeat_at = ?, firmware_version = ?, uptime_seconds = ?,
                       wifi_rssi = ?, free_heap_bytes = ?""" + RETURNING,
                ts(now), ts(now), beat.firmwareVersion(), beat.uptimeSeconds(), beat.wifiRssi(), beat.freeHeapBytes(), machineId, ts(now)));
    }

    /** status ONLINE: presence plus the diagnostics it carries; a field the message omits keeps its stored value. */
    @Transactional
    public void online(UUID machineId, String machineCode, String firmwareVersion, Long uptimeSeconds, Instant now) {
        after(machineId, machineCode, now, uptimeSeconds, update("""
                UPDATE machines SET last_seen_at = ?, firmware_version = COALESCE(CAST(? AS VARCHAR), firmware_version),
                       uptime_seconds = COALESCE(CAST(? AS BIGINT), uptime_seconds)""" + RETURNING,
                ts(now), firmwareVersion, uptimeSeconds, machineId, ts(now)));
    }

    /** status OFFLINE (Last Will): last_offline_at only; last_seen_at is not touched, so connectivity becomes OFFLINE at once. */
    @Transactional
    public void offline(UUID machineId, String machineCode, Instant now) {
        int rows = jdbc.update("UPDATE machines SET last_offline_at = ? WHERE id = ? AND (last_offline_at IS NULL OR last_offline_at < ?)",
                ts(now), machineId, ts(now));
        if (rows == 1) events.publishEvent(new MachineOfflineReportedEvent(machineId, machineCode, now));
    }

    private List<Previous> update(String sql, Object... args) {
        return jdbc.query(sql, (rs, row) -> new Previous(instant(rs.getTimestamp(1)), instant(rs.getTimestamp(2)),
                rs.getObject(3) == null ? null : rs.getLong(3)), args);
    }

    private void after(UUID machineId, String machineCode, Instant now, Long newUptime, List<Previous> result) {
        if (result.isEmpty()) {
            log.debug("Presence of machine {} not updated: a newer message was already applied", machineCode);
            return;
        }
        Previous before = result.getFirst();
        if (before.lastSeenAt() != null && (connectivity.silentLongerThanOfflineThreshold(before.lastSeenAt(), now)
                || (before.lastOfflineAt() != null && !before.lastOfflineAt().isBefore(before.lastSeenAt())))) {
            log.info("Machine {} back online after {}", machineCode, Duration.between(before.lastSeenAt(), now).withNanos(0));
        }
        if (newUptime != null && before.uptimeSeconds() != null && newUptime < before.uptimeSeconds()) {
            events.publishEvent(new MachineRebootDetectedEvent(machineId, machineCode, before.uptimeSeconds(), newUptime));
        }
    }

    private static Timestamp ts(Instant instant) {
        return Timestamp.from(instant);
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
