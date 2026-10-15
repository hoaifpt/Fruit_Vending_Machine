package com.fruitmachine.backend.machine.kiosk.entity;

import com.fruitmachine.backend.common.entity.CreatedEntity;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.kiosk.enums.KioskCredentialStatus;
import com.fruitmachine.backend.user.entity.User;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Machine-bound kiosk credential; only the lookup prefix and SHA-256 digest are persisted. */
@Entity
@Table(name = "kiosk_credentials")
@Getter
@Setter
@NoArgsConstructor
public class KioskCredential extends CreatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "machine_id", nullable = false)
    private Machine machine;

    @Column(name = "machine_id", nullable = false, insertable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private UUID machineId;

    @Column(name = "key_prefix", length = 16, nullable = false, unique = true)
    private String keyPrefix;

    @Column(name = "secret_hash", length = 64, nullable = false)
    private String secretHash;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private KioskCredentialStatus status = KioskCredentialStatus.ACTIVE;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "revoked_by")
    private User revokedBy;

    @Column(name = "revoked_at", columnDefinition = "timestamptz")
    private Instant revokedAt;
}
