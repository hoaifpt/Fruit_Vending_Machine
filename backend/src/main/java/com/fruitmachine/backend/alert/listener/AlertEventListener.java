package com.fruitmachine.backend.alert.listener;

import com.fruitmachine.backend.alert.event.AlertRaisedEvent;
import com.fruitmachine.backend.alert.service.AlertService;
import com.fruitmachine.backend.dispense.event.DispenseFailedEvent;
import com.fruitmachine.backend.dispense.event.DispenseLateSuccessEvent;
import com.fruitmachine.backend.dispense.event.DispenseMultipleBowlsEvent;
import com.fruitmachine.backend.notification.service.NotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Event-based alerts and notifications, each after the originating transaction committed and in a new transaction (the services
 * use REQUIRES_NEW). Failures are logged and swallowed: an exception after commit would reach the caller of the committed
 * transaction (MQTT callback, payment webhook, sweep).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AlertEventListener {
    private final AlertService alerts;
    private final NotificationService notifications;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseFailedEvent event) {
        run("DISPENSE_FAILED alert for command " + event.commandCode(), () -> alerts.onDispenseFailed(event));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseLateSuccessEvent event) {
        run("DISPENSE_FAILED resolution for command " + event.commandCode(), () -> alerts.onDispenseLateSuccess(event.commandId()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(DispenseMultipleBowlsEvent event) {
        run("MULTIPLE_BOWLS_DETECTED alert for command " + event.commandCode(), () -> alerts.onMultipleBowls(event));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(AlertRaisedEvent event) {
        run("notifications for alert " + event.alertId(), () -> notifications.notifyAlert(event.alertId()));
    }

    private static void run(String what, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException ex) {
            log.error("Could not create {}", what, ex);
        }
    }
}
