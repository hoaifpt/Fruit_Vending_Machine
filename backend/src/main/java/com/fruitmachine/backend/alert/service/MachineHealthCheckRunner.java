package com.fruitmachine.backend.alert.service;

import com.fruitmachine.backend.alert.repository.HealthCheckQueries;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * One health-check run over every ACTIVE or MAINTENANCE machine. The run holds a transaction-scoped advisory lock for its whole
 * duration, so overlapping runs (slow run, second instance) skip instead of doubling the work; each machine is checked in its own
 * transaction and one failing machine never stops the others. The scheduled job calls {@link #runOnce()}; tests call it directly.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MachineHealthCheckRunner {
    public static final int SKIPPED = -1;

    private final HealthCheckQueries queries;
    private final MachineHealthCheckService checks;
    private final TransactionTemplate transactions;
    private final Clock clock;

    /** @return machines checked successfully, or {@link #SKIPPED} when another run is in progress */
    public int runOnce() {
        Integer checked = transactions.execute(status -> {
            if (!queries.tryLockRun()) {
                log.debug("Health check skipped: another run is in progress");
                return SKIPPED;
            }
            Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
            int ok = 0;
            for (UUID machineId : queries.machinesToCheck()) {
                try {
                    checks.checkMachine(machineId, now);
                    ok++;
                } catch (RuntimeException ex) {
                    log.error("Health check of machine {} failed; continuing with the other machines", machineId, ex);
                }
            }
            return ok;
        });
        return checked == null ? SKIPPED : checked;
    }
}
