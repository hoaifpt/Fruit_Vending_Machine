package com.fruitmachine.backend.machine.listener;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.dispense.event.DispenseFailedEvent;
import com.fruitmachine.backend.dispense.event.DispenseLateSuccessEvent;
import com.fruitmachine.backend.dispense.event.DispenseMultipleBowlsEvent;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.event.MachineMaintenanceEnteredEvent;
import com.fruitmachine.backend.machine.event.MachineRebootDetectedEvent;
import com.fruitmachine.backend.machine.repository.MachineSlotRepository;
import com.fruitmachine.backend.machine.service.MachineEventRecorder;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Backend decisions about a machine go to its history (source BACKEND) only after the deciding transaction committed, in a new
 * transaction, so a rolled-back decision never appears. Payloads hold ids and reasons only: no secrets, no customer data.
 * A failure is logged and swallowed: an exception after commit would otherwise reach the caller of the committed transaction.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MachineDomainEventListener {
    public static final String DISPENSE_FAILED = "BACKEND_DISPENSE_FAILED";
    public static final String DISPENSE_LATE_SUCCESS = "BACKEND_DISPENSE_LATE_SUCCESS";
    public static final String DISPENSE_MULTIPLE_BOWLS = "BACKEND_DISPENSE_MULTIPLE_BOWLS";
    public static final String MAINTENANCE_ENTERED = "BACKEND_MAINTENANCE_ENTERED";
    public static final String REBOOT_DETECTED = "BACKEND_REBOOT_DETECTED";

    private final MachineEventRecorder history;
    private final MachineSlotRepository slots;
    private final Clock clock;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseFailedEvent event) {
        record(event.machineId(), DISPENSE_FAILED, dispense(event.commandId(), event.commandCode(), event.orderId(), event.slotId())
                .put("reason", event.reason()).put("bowlReturned", event.bowlReturned()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseLateSuccessEvent event) {
        record(event.machineId(), DISPENSE_LATE_SUCCESS, dispense(event.commandId(), event.commandCode(), event.orderId(), event.slotId()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseMultipleBowlsEvent event) {
        record(event.machineId(), DISPENSE_MULTIPLE_BOWLS, dispense(event.commandId(), event.commandCode(), event.orderId(), event.slotId())
                .put("bowlCount", event.bowlCount()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(MachineMaintenanceEnteredEvent event) {
        record(event.machineId(), MAINTENANCE_ENTERED, JsonNodeFactory.instance.objectNode().put("reason", event.reason()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(MachineRebootDetectedEvent event) {
        record(event.machineId(), REBOOT_DETECTED, JsonNodeFactory.instance.objectNode()
                .put("previousUptimeSeconds", event.previousUptimeSeconds()).put("newUptimeSeconds", event.newUptimeSeconds()));
    }

    private ObjectNode dispense(UUID commandId, String commandCode, UUID orderId, UUID slotId) {
        return JsonNodeFactory.instance.objectNode()
                .put("commandId", commandId.toString())
                .put("commandCode", commandCode)
                .put("orderId", orderId.toString())
                .put("slotId", slotId.toString())
                .put("slotCode", slots.findById(slotId).map(MachineSlot::getSlotCode).orElse(null));
    }

    private void record(UUID machineId, String eventType, ObjectNode payload) {
        try {
            history.recordBackendEvent(machineId, eventType, payload, clock.instant().truncatedTo(ChronoUnit.MICROS));
        } catch (RuntimeException ex) {
            log.error("{} for machine {} could not be written to the machine history", eventType, machineId, ex);
        }
    }
}
