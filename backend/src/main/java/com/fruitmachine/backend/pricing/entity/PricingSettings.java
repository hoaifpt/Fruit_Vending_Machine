package com.fruitmachine.backend.pricing.entity;

import com.fruitmachine.backend.common.entity.UuidEntity;
import com.fruitmachine.backend.user.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** The one pricing_settings row (V18 singleton, seeded enabled / 50 %). Never inserted or deleted by the application. */
@Entity
@Table(name = "pricing_settings")
@Getter
@Setter
@NoArgsConstructor
public class PricingSettings extends UuidEntity {
    @Column(name = "near_expiry_enabled", nullable = false)
    private boolean nearExpiryEnabled;

    @Column(name = "near_expiry_percent", nullable = false)
    private Short nearExpiryPercent;

    /** Optimistic version the Admin sends back on PUT; a stale value is 409. */
    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz")
    private Instant updatedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "updated_by")
    private User updatedBy;

    /** Always TRUE (UNIQUE + CHECK): what makes the row a singleton. Read-only. */
    @Column(name = "singleton", nullable = false, insertable = false, updatable = false)
    @Setter(lombok.AccessLevel.NONE)
    private boolean singleton = true;
}
