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

    @Column(name = "last_seen_at", columnDefinition = "timestamptz")
    private Instant lastSeenAt;

    @OneToMany(mappedBy = "machine", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<MachineSlot> slots = new HashSet<>();
}
