package com.fruitmachine.backend.machine.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.machine.enums.MachineEventSource;
import com.fruitmachine.backend.machine.repository.MachineEventWriter;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes the machine history (issue #56), each row in its own transaction so history never depends on, and never rolls back,
 * the business processing around it. Callers catch failures: logging must never break MQTT processing.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MachineEventRecorder {
    public enum Recorded { NEW, DUPLICATE }

    /** Longest event_type the column holds. */
    public static final int EVENT_TYPE_MAX = 64;
    /** Stored for an events message whose eventType is missing, not text or blank. */
    public static final String UNSPECIFIED = "UNSPECIFIED";
    public static final String STATUS_ONLINE = "STATUS_ONLINE";
    public static final String STATUS_OFFLINE = "STATUS_OFFLINE";

    private final MachineEventWriter writer;
    private final ObjectMapper json;

    /** A validated machine message; the same (machine, messageId) is stored once. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Recorded recordMachineMessage(UUID machineId, String eventType, String messageId, JsonNode payload, Instant receivedAt) {
        boolean inserted = writer.insert(machineId, eventType(eventType), write(payload), MachineEventSource.MACHINE, messageId, receivedAt);
        if (!inserted) log.debug("Machine {} message {} is already in the history", machineId, messageId);
        return inserted ? Recorded.NEW : Recorded.DUPLICATE;
    }

    /** A backend decision about a machine, recorded after the deciding transaction committed. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordBackendEvent(UUID machineId, String eventType, JsonNode payload, Instant at) {
        writer.insert(machineId, eventType(eventType), write(payload), MachineEventSource.BACKEND, null, at);
    }

    /** Unknown types are kept as reported (forward compatibility); only a missing or oversize type is normalized. */
    static String eventType(String reported) {
        if (reported == null || reported.isBlank()) return UNSPECIFIED;
        String type = reported.strip();
        return type.length() > EVENT_TYPE_MAX ? type.substring(0, EVENT_TYPE_MAX) : type;
    }

    private String write(JsonNode payload) {
        try {
            return json.writeValueAsString(payload);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Machine event payload is not serializable", ex);
        }
    }
}
