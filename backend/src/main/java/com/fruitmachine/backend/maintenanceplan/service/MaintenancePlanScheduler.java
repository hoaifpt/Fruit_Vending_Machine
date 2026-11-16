package com.fruitmachine.backend.maintenanceplan.service;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.maintenanceplan.repository.MaintenancePlanRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * One generation run (issue #70 §3): an advisory lock keeps runs from overlapping (also across instances); each plan is generated in a
 * transaction of its own, and a failing plan never stops the others.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MaintenancePlanScheduler {
    public static final int SKIPPED = -1;

    private final MaintenancePlanRepository plans;
    private final MaintenancePlanGenerator generator;
    private final BusinessCalendar calendar;
    private final TransactionTemplate transactions;

    /** @return work orders created, or {@link #SKIPPED} when another run holds the lock */
    public int runOnce(Instant now) {
        LocalDate today = calendar.today(now);
        Integer created = transactions.execute(status -> {
            if (!plans.tryLockRun()) return SKIPPED;
            int count = 0;
            List<UUID> due = plans.findDueIds(today);
            for (UUID planId : due) {
                try {
                    if (generator.generateIfDue(planId, today) == MaintenancePlanGenerator.Result.CREATED) count++;
                } catch (RuntimeException ex) {
                    log.warn("Maintenance plan {} could not generate its work order; the next run retries", planId, ex);
                }
            }
            return count;
        });
        return created == null ? 0 : created;
    }
}
