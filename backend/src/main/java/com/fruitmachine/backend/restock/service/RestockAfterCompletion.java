package com.fruitmachine.backend.restock.service;

import com.fruitmachine.backend.alert.service.MachineHealthCheckService;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import com.fruitmachine.backend.workorder.event.WorkOrderCompletedEvent;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** After a RESTOCK work order is DONE, the machine's health check runs at once so cleared stock alerts resolve now (issue #68 §5). */
@Slf4j
@Component
@RequiredArgsConstructor
public class RestockAfterCompletion {
    private final MachineHealthCheckService healthCheck;
    private final Clock clock;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(WorkOrderCompletedEvent event) {
        if (event.type() != WorkOrderType.RESTOCK) return;
        try {
            healthCheck.checkMachine(event.machineId(), clock.instant().truncatedTo(ChronoUnit.MICROS));
        } catch (RuntimeException ex) {
            log.error("Health check after restock work order {} failed; the next scheduled run retries", event.workOrderId(), ex);
        }
    }
}
