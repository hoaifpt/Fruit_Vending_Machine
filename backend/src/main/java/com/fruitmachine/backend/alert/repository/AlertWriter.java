package com.fruitmachine.backend.alert.repository;

import com.fruitmachine.backend.alert.service.AlertSpec;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** System writes of alerts: de-duplicated insert and auto-resolve, each one conditional statement on uq_alerts_open_dedupe. */
@Repository
@RequiredArgsConstructor
public class AlertWriter {
    public static final String CONDITION_CLEARED = "Condition cleared";
    private final JdbcTemplate jdbc;

    /** @return the new alert id, or empty when an unresolved alert with the same key already exists */
    public Optional<UUID> insertIfAbsent(AlertSpec spec, Instant now) {
        Timestamp at = Timestamp.from(now);
        List<UUID> ids = jdbc.query("""
                INSERT INTO alerts (machine_id, slot_id, type, severity, title, message, status, triggered_at, error_code, dedupe_key,
                                    created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
                ON CONFLICT (dedupe_key) WHERE status <> 'RESOLVED' DO NOTHING
                RETURNING id""", (rs, row) -> rs.getObject(1, UUID.class),
                spec.machineId(), spec.slotId(), spec.type().name(), spec.severity().name(), spec.title(), spec.message(), at,
                spec.errorCode(), spec.dedupeKey(), at, at);
        return ids.stream().findFirst();
    }

    /** OPEN/ACKNOWLEDGED -> RESOLVED by the system (resolved_by NULL). @return true when an alert was resolved */
    public boolean resolveBySystem(String dedupeKey, Instant now) {
        Timestamp at = Timestamp.from(now);
        return jdbc.update("""
                UPDATE alerts SET status = 'RESOLVED', resolved_at = GREATEST(?, triggered_at), resolved_by = NULL,
                       resolution_note = ?, updated_at = GREATEST(?, created_at)
                WHERE dedupe_key = ? AND status <> 'RESOLVED'""", at, CONDITION_CLEARED, at, dedupeKey) > 0;
    }

    public boolean isUnresolved(String dedupeKey) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM alerts WHERE dedupe_key = ? AND status <> 'RESOLVED')",
                Boolean.class, dedupeKey));
    }
}
