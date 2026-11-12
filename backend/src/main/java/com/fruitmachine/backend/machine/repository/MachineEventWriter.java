package com.fruitmachine.backend.machine.repository;

import com.fruitmachine.backend.machine.enums.MachineEventSource;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** The only writer of machine_events: inserts, never updates or deletes (append-only history). */
@Repository
@RequiredArgsConstructor
public class MachineEventWriter {
    private final JdbcTemplate jdbc;

    /** @return true when a row was inserted, false when the machine already sent this messageId (MQTT redelivery) */
    public boolean insert(UUID machineId, String eventType, String payloadJson, MachineEventSource source, String messageId, Instant createdAt) {
        return jdbc.update("""
                INSERT INTO machine_events (machine_id, event_type, payload, source, message_id, created_at)
                VALUES (?, ?, CAST(? AS JSONB), ?, ?, ?)
                ON CONFLICT (machine_id, message_id) WHERE message_id IS NOT NULL DO NOTHING""",
                machineId, eventType, payloadJson, source.name(), messageId, Timestamp.from(createdAt)) == 1;
    }
}
