package com.fruitmachine.backend.dispense.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** Triggers only: first delivery after the payment commit, then a periodic sweep for re-sends and timeouts. */
@Slf4j
@Component
@RequiredArgsConstructor
public class DispenseDispatcher {
    private static final int SWEEP_BATCH = 50;
    private final DispenseService dispense;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRequested(DispenseRequestedEvent event) {
        try {
            dispense.send(event.commandId());
        } catch (RuntimeException ex) {
            // Never fail the payment webhook response: the sweep retries this command.
            log.warn("First delivery of dispense command {} failed; the sweep will retry", event.commandId(), ex);
        }
    }

    @Component
    @RequiredArgsConstructor
    @ConditionalOnProperty(name = "app.dispense.sweep.enabled", havingValue = "true", matchIfMissing = true)
    static class Sweep {
        private final DispenseService dispense;

        @Scheduled(fixedDelayString = "${app.dispense.sweep.interval:PT2S}")
        public void run() {
            for (var id : dispense.openCommandIds(SWEEP_BATCH)) {
                try {
                    dispense.expireOrResend(id);
                } catch (RuntimeException ex) {
                    log.warn("Dispense sweep failed for command {}", id, ex);
                }
            }
        }
    }
}
