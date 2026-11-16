package com.fruitmachine.backend.workorder.job;

import com.fruitmachine.backend.workorder.service.WorkOrderService;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Unfinished work orders past their due time are announced once each (app.work-order.overdue, every 5 minutes). */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkOrderOverdueJob {
    private static final int BATCH = 100;
    private final WorkOrderService service;

    /** @return how many work orders were announced as overdue */
    public int runOnce(Instant now) {
        int marked = 0;
        for (var id : service.overdueIds(now, BATCH)) {
            try {
                if (service.markOverdue(id, now)) marked++;
            } catch (RuntimeException ex) {
                log.warn("Overdue check of work order {} failed", id, ex);
            }
        }
        return marked;
    }

    /** The schedule only; tests call {@link #runOnce} directly with a controlled time. */
    @Component
    @RequiredArgsConstructor
    @ConditionalOnProperty(name = "app.work-order.overdue.enabled", havingValue = "true", matchIfMissing = true)
    static class Tick {
        private final WorkOrderOverdueJob job;
        private final Clock clock;

        @Scheduled(fixedDelayString = "${app.work-order.overdue.interval:PT5M}", initialDelayString = "${app.work-order.overdue.interval:PT5M}")
        public void run() {
            job.runOnce(clock.instant().truncatedTo(ChronoUnit.MICROS));
        }
    }
}
