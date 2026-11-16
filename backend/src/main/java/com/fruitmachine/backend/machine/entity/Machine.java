package com.fruitmachine.backend.machine.entity;

import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.common.entity.UpdatedEntity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "machines")
@Getter
@Setter
@NoArgsConstructor
public class Machine extends UpdatedEntity {
    /**
     * Issue #74: token of the public report QR; set by the database default on insert (32 characters) and replaced by a direct update
     * in MachineReportLinkService on rotation (22-character base64url). Never part of machine responses.
     */
    @org.hibernate.annotations.Generated(event = org.hibernate.generator.EventType.INSERT)
    @Column(name = "report_token", length = 32, nullable = false, insertable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private String reportToken;

    @Column(name = "code", length = 64, nullable = false, unique = true)
    private String code;

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    @Column(name = "location", length = 500)
    private String location;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private MachineStatus status = MachineStatus.ACTIVE;

    @Column(name = "temperature_min", precision = 5, scale = 2, nullable = false)
    private BigDecimal temperatureMin = new BigDecimal("2");

    @Column(name = "temperature_max", precision = 5, scale = 2, nullable = false)
    private BigDecimal temperatureMax = new BigDecimal("8");

    @Column(name = "humidity_min", precision = 5, scale = 2, nullable = false)
    private BigDecimal humidityMin = BigDecimal.ZERO;

    @Column(name = "humidity_max", precision = 5, scale = 2, nullable = false)
    private BigDecimal humidityMax = new BigDecimal("100");

    // Presence and diagnostics (V2 last_seen_at, V15 the rest) are written only by MachinePresenceService with conditional SQL
    // updates. They are not insertable/updatable here, so a configuration change never writes back a stale value.
    @Column(name = "last_seen_at", columnDefinition = "timestamptz", insertable = false, updatable = false)
    private Instant lastSeenAt;

    @Column(name = "last_heartbeat_at", columnDefinition = "timestamptz", insertable = false, updatable = false)
    private Instant lastHeartbeatAt;

    @Column(name = "last_offline_at", columnDefinition = "timestamptz", insertable = false, updatable = false)
    private Instant lastOfflineAt;

    @Column(name = "firmware_version", length = 32, insertable = false, updatable = false)
    private String firmwareVersion;

    @Column(name = "uptime_seconds", insertable = false, updatable = false)
    private Long uptimeSeconds;

    @Column(name = "wifi_rssi", insertable = false, updatable = false)
    private Short wifiRssi;

    @Column(name = "free_heap_bytes", insertable = false, updatable = false)
    private Long freeHeapBytes;

    @OneToMany(mappedBy = "machine", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<MachineSlot> slots = new HashSet<>();
}
