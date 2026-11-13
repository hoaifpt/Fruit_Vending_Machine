package com.fruitmachine.backend.notification.entity;

import com.fruitmachine.backend.alert.entity.Alert;
import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.common.entity.CreatedEntity;
import com.fruitmachine.backend.user.entity.User;
import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** A portal notification for one user (issue #58), created for every new alert for users with ALERT_NOTIFY. */
@Entity
@Table(name = "notifications")
@Getter
@Setter
@NoArgsConstructor
public class Notification extends CreatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "alert_id")
    private Alert alert;

    @Column(name = "title", length = 255, nullable = false)
    private String title;

    @Column(name = "message", length = 1000)
    private String message;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "severity", length = 16, nullable = false)
    private AlertSeverity severity;

    @Column(name = "read_at", columnDefinition = "timestamptz")
    private Instant readAt;
}
