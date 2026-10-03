package com.fruitmachine.backend.alert.entity;

import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertStatus;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.common.entity.UpdatedEntity;
import com.fruitmachine.backend.user.entity.User;

import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "alerts")
@Getter
@Setter
@NoArgsConstructor
public class Alert extends UpdatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "machine_id", nullable = false)
    private Machine machine;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "type", length = 32, nullable = false)
    private AlertType type;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "severity", length = 16, nullable = false)
    private AlertSeverity severity;

    @Column(name = "title", length = 255, nullable = false)
    private String title;

    @Column(name = "message", columnDefinition = "text")
    private String message;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private AlertStatus status = AlertStatus.OPEN;

    @Column(name = "triggered_at", columnDefinition = "timestamptz", nullable = false)
    private Instant triggeredAt = Instant.now();

    @Column(name = "resolved_at", columnDefinition = "timestamptz")
    private Instant resolvedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "resolved_by")
    private User resolvedBy;
}
