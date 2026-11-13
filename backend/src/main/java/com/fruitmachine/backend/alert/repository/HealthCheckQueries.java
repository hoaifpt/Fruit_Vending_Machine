package com.fruitmachine.backend.alert.repository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Aggregate reads of the health check: one statement per machine for the slots, one for the environment (no N+1). */
@Repository
@RequiredArgsConstructor
public class HealthCheckQueries {
    /** FVM operation 4: one health-check run at a time, also across instances. */
    private static final int FVM = 0x46564D, HEALTH_CHECK = 4;
    private final JdbcTemplate jdbc;

    /**
     * Per slot of the machine: sellable bowls (the kiosk catalog rule: the slot's head is an AVAILABLE bowl of an ACTIVE product that
     * outlives {@code holdDeadline}, in an ACTIVE slot; count of AVAILABLE unexpired bowls of that product in the slot), physical bowls
     * expiring within the window, and physical bowls already expired. Physical = AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED.
     */
    public record SlotCondition(UUID slotId, String slotCode, String slotStatus, long sellable, long expiring, long expired) { }

    public List<SlotCondition> slots(UUID machineId, Instant now, Instant holdDeadline, Instant expiringBy) {
        return jdbc.query("""
                WITH phys AS (
                    SELECT i.id, i.slot_id, i.status, i.loaded_at, b.expires_at, b.product_id
                    FROM inventory_items i JOIN product_batches b ON b.id = i.batch_id JOIN machine_slots s ON s.id = i.slot_id
                    WHERE s.machine_id = ? AND i.status IN ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED')
                ), heads AS (
                    SELECT DISTINCT ON (slot_id) slot_id, status, expires_at, product_id FROM phys ORDER BY slot_id, loaded_at, id
                )
                SELECT s.id, s.slot_code, s.status,
                       (SELECT count(*) FROM phys x JOIN heads h ON h.slot_id = x.slot_id JOIN products p ON p.id = h.product_id
                        WHERE x.slot_id = s.id AND s.status = 'ACTIVE' AND h.status = 'AVAILABLE' AND h.expires_at > ? AND p.status = 'ACTIVE'
                          AND x.status = 'AVAILABLE' AND x.product_id = h.product_id AND x.expires_at > ?) AS sellable,
                       (SELECT count(*) FROM phys x WHERE x.slot_id = s.id AND x.status <> 'EXPIRED' AND x.expires_at > ? AND x.expires_at <= ?) AS expiring,
                       (SELECT count(*) FROM phys x WHERE x.slot_id = s.id AND (x.status = 'EXPIRED' OR x.expires_at <= ?)) AS expired
                FROM machine_slots s WHERE s.machine_id = ? ORDER BY s.slot_code""",
                (rs, row) -> new SlotCondition(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getLong(5), rs.getLong(6)),
                machineId, ts(holdDeadline), ts(holdDeadline), ts(now), ts(expiringBy), ts(now), machineId);
    }

    /**
     * Latest temperature/humidity and, for each direction, the start of the current run of out-of-range readings (null when the
     * latest reading is in range). Readings without that value are ignored.
     */
    public record Environment(Instant temperatureAt, BigDecimal temperature, Instant highSince, Instant lowSince,
            Instant humidityAt, BigDecimal humidity, Instant humidHighSince) { }

    public Environment environment(UUID machineId, BigDecimal minTemperature, BigDecimal maxTemperature, BigDecimal maxHumidity) {
        return jdbc.queryForObject("""
                WITH t AS (SELECT recorded_at, temperature FROM sensor_readings WHERE machine_id = ? AND temperature IS NOT NULL),
                     h AS (SELECT recorded_at, humidity FROM sensor_readings WHERE machine_id = ? AND humidity IS NOT NULL)
                SELECT (SELECT max(recorded_at) FROM t),
                       (SELECT temperature FROM t ORDER BY recorded_at DESC LIMIT 1),
                       (SELECT min(recorded_at) FROM t WHERE recorded_at > coalesce((SELECT max(recorded_at) FROM t WHERE temperature <= ?), '-infinity')),
                       (SELECT min(recorded_at) FROM t WHERE recorded_at > coalesce((SELECT max(recorded_at) FROM t WHERE temperature >= ?), '-infinity')),
                       (SELECT max(recorded_at) FROM h),
                       (SELECT humidity FROM h ORDER BY recorded_at DESC LIMIT 1),
                       (SELECT min(recorded_at) FROM h WHERE recorded_at > coalesce((SELECT max(recorded_at) FROM h WHERE humidity <= ?), '-infinity'))""",
                (rs, row) -> new Environment(instant(rs.getTimestamp(1)), rs.getBigDecimal(2), instant(rs.getTimestamp(3)), instant(rs.getTimestamp(4)),
                        instant(rs.getTimestamp(5)), rs.getBigDecimal(6), instant(rs.getTimestamp(7))),
                machineId, machineId, maxTemperature, minTemperature, maxHumidity);
    }

    public List<UUID> machinesToCheck() {
        return jdbc.queryForList("SELECT id FROM machines WHERE status IN ('ACTIVE', 'MAINTENANCE') ORDER BY code", UUID.class);
    }

    /** @return false when another run holds the lock; released when the caller's transaction ends */
    public boolean tryLockRun() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Health check lock requires a transaction");
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(?, ?)", Boolean.class, FVM, HEALTH_CHECK));
    }

    private static Timestamp ts(Instant instant) {
        return Timestamp.from(instant);
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
