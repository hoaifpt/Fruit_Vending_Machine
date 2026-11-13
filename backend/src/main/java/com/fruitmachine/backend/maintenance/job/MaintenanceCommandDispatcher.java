package com.fruitmachine.backend.maintenance.job;

import com.fruitmachine.backend.maintenance.event.MaintenanceCommandRequestedEvent;
import com.fruitmachine.backend.maintenance.service.MaintenanceCommandService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** Triggers only (like DispenseDispatcher): first delivery after the creating commit, then a 1 s tick for re-sends and timeouts. */
@Slf4j
@Component
@RequiredArgsConstructor
public class MaintenanceCommandDispatcher {
    private static final int BATCH = 50;
    private final MaintenanceCommandService service;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRequested(MaintenanceCommandRequestedEvent event) {
        try {
            service.send(event.commandId());
        } catch (RuntimeException ex) {
            log.warn("First delivery of maintenance command {} failed; the dispatcher will retry", event.commandId(), ex);
        }
    }

    @Component
    @RequiredArgsConstructor
    @ConditionalOnProperty(name = "app.maintenance-command.dispatcher.enabled", havingValue = "true", matchIfMissing = true)
    static class Tick {
        private final MaintenanceCommandService service;

        @Scheduled(fixedDelayString = "${app.maintenance-command.dispatcher.interval:PT1S}")
        public void run() {
            for (var id : service.openCommandIds(BATCH)) {
                try {
                    service.expireOrResend(id);
                } catch (RuntimeException ex) {
                    log.warn("Maintenance dispatcher failed for command {}", id, ex);
                }
            }
        }
    }
}
