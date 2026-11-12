package com.fruitmachine.backend.machine.entity;

import com.fruitmachine.backend.common.entity.CreatedEntity;
import com.fruitmachine.backend.machine.enums.MachineEventSource;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * History of a machine (issue #56): what it reported (source MACHINE, one row per MQTT messageId) and what the backend decided about
 * it (source BACKEND). Evidence only, append-only by application policy: rows are inserted by MachineEventWriter and never changed;
 * MachineEventRepository has no save, update or delete method.
 */
@Entity
@Table(name = "machine_events")
@Getter
@Setter
@NoArgsConstructor
public class MachineEvent extends CreatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "machine_id", nullable = false)
    private Machine machine;

    @Column(name = "event_type", length = 64, nullable = false)
    private String eventType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", columnDefinition = "jsonb", nullable = false)
    private JsonNode payload = JsonNodeFactory.instance.objectNode();

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "source", length = 16, nullable = false)
    private MachineEventSource source = MachineEventSource.MACHINE;

    /** The envelope messageId for MACHINE rows (unique per machine); null for BACKEND rows. */
    @Column(name = "message_id", length = 64)
    private String messageId;
}
