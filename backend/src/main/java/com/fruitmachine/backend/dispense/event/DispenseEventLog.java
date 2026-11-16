package com.fruitmachine.backend.dispense.event;

import com.fruitmachine.backend.machine.event.MachineMaintenanceEnteredEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** Logs the dispense domain events once their transaction committed. Alerts (3.6) and event history (3.5) will listen the same way. */
@Slf4j
@Component
public class DispenseEventLog {
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseFailedEvent event) {
        log.warn("Dispense command {} of order {} failed: {} ({})", event.commandCode(), event.orderId(), event.reason(),
                event.bowlReturned() ? "not executed, bowl available again" : "outcome unknown, bowl blocked");
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseLateSuccessEvent event) {
        log.warn("Dispense command {} of order {} succeeded after it had failed; the order is completed", event.commandCode(), event.orderId());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseMultipleBowlsEvent event) {
        log.warn("Dispense command {} released {} bowls on machine {}; the column needs reconciliation", event.commandCode(),
                event.bowlCount() == null ? "several" : event.bowlCount(), event.machineId());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(MachineMaintenanceEnteredEvent event) {
        log.warn("Machine {} was put in MAINTENANCE by the system: {}", event.machineCode(), event.reason());
    }
}
