package com.fruitmachine.backend.machine.service;

import com.fruitmachine.backend.config.properties.MachineHealthProperties;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.enums.MachineConnectivity;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import java.time.Clock;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Connectivity rules, in Java (for responses) and as SQL predicates (for the list filter), so both always agree:
 * <pre>
 * last_seen_at IS NULL                  NEVER_SEEN
 * last_offline_at >= last_seen_at       OFFLINE (Last Will, immediately)
 * now - last_seen_at > offline-after    OFFLINE
 * now - last_seen_at > warning-after    WARNING
 * otherwise                             ONLINE
 * </pre>
 */
@Component
@RequiredArgsConstructor
@EnableConfigurationProperties(MachineHealthProperties.class)
public class ConnectivityEvaluator {
    private final MachineHealthProperties properties;
    private final Clock clock;

    public MachineConnectivity evaluate(Machine machine) {
        return evaluate(machine.getLastSeenAt(), machine.getLastOfflineAt(), clock.instant());
    }

    public MachineConnectivity evaluate(Instant lastSeenAt, Instant lastOfflineAt, Instant now) {
        if (lastSeenAt == null) return MachineConnectivity.NEVER_SEEN;
        if (lastOfflineAt != null && !lastOfflineAt.isBefore(lastSeenAt)) return MachineConnectivity.OFFLINE;
        if (lastSeenAt.isBefore(now.minus(properties.offlineAfter()))) return MachineConnectivity.OFFLINE;
        if (lastSeenAt.isBefore(now.minus(properties.warningAfter()))) return MachineConnectivity.WARNING;
        return MachineConnectivity.ONLINE;
    }

    /** True when a machine last seen at {@code lastSeenAt} had been silent long enough to count as offline at {@code now}. */
    public boolean silentLongerThanOfflineThreshold(Instant lastSeenAt, Instant now) {
        return lastSeenAt != null && lastSeenAt.isBefore(now.minus(properties.offlineAfter()));
    }

    /** The same rules as {@link #evaluate} as a criteria predicate on Machine. */
    public Predicate predicate(MachineConnectivity connectivity, Root<Machine> root, CriteriaBuilder cb, Instant now) {
        var seen = root.<Instant>get("lastSeenAt");
        var offline = root.<Instant>get("lastOfflineAt");
        Instant offlineCut = now.minus(properties.offlineAfter()), warningCut = now.minus(properties.warningAfter());
        Predicate notReportedOffline = cb.or(cb.isNull(offline), cb.lessThan(offline, seen));
        return switch (connectivity) {
            case NEVER_SEEN -> cb.isNull(seen);
            case OFFLINE -> cb.and(cb.isNotNull(seen), cb.or(cb.and(cb.isNotNull(offline), cb.greaterThanOrEqualTo(offline, seen)),
                    cb.lessThan(seen, offlineCut)));
            case WARNING -> cb.and(cb.isNotNull(seen), notReportedOffline, cb.greaterThanOrEqualTo(seen, offlineCut), cb.lessThan(seen, warningCut));
            case ONLINE -> cb.and(cb.isNotNull(seen), notReportedOffline, cb.greaterThanOrEqualTo(seen, warningCut));
        };
    }
}
