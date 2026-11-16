package com.fruitmachine.backend.machine.event;

import com.fruitmachine.backend.sensor.event.TelemetryRecordedEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** Logs machine health events once their transaction committed. Event history (3.5) and alerts (3.6) will listen the same way. */
@Slf4j
@Component
public class MachineHealthEventLog {
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(MachineRebootDetectedEvent event) {
        log.info("Machine {} restarted: uptime went from {} s to {} s", event.machineCode(), event.previousUptimeSeconds(), event.newUptimeSeconds());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(MachineOfflineReportedEvent event) {
        log.info("Machine {} reported OFFLINE (Last Will) at {}", event.machineCode(), event.reportedAt());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(TelemetryRecordedEvent event) {
        log.debug("Telemetry of machine {} at {}: {} C, {} %RH", event.machineId(), event.recordedAt(), event.temperature(), event.humidity());
    }
}
