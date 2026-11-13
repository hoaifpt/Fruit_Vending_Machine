# Chat handoff - Issue #58, 2026-11-13

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/58, [BE] Alert & Notification Management.
Branch feature/58-alert-notification from dev 49e8f17 (includes #48, #49, #52, #53, #56).
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: V17 (alerts columns + uq_alerts_open_dedupe, HARDWARE_FAULT, notifications, ALERT_READ/ALERT_MANAGE/ALERT_NOTIFY).
AlertService (raise / autoResolve via AlertWriter JDBC, dispense + machine-event alerts), MachineHealthCheckJob/Runner/Service
(app.health-check.*), AlertEventListener (AFTER_COMMIT), NotificationService. APIs: /api/v1/alerts (list, get, acknowledge, resolve),
/api/v1/notifications (me, me/unread-count, {id}/read, me/read-all).
Docs: docs/alerts.md, mqtt-contract 1.4.0, api.yaml, database-migration.md, permission-authorization.md, .ai/DATABASE.md §20.

Verification: `mvn clean verify` 753 tests, 0 failures.
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
