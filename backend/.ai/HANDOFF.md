# Chat handoff - Issue #52, 2026-11-10

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/52, [BE] Harden Dispense Command Flow.
Branch feature/52-harden-dispense-flow from origin/dev 8ac9c00 (includes #48 PR #50 and #49 PR #51).
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: V14 (slot_code A/B with safe normalization that stops on ambiguous data, dispense_commands.failure_reason + CHECK +
LEGACY_UNKNOWN backfill, in-flight index). DispenseService: columnCode = slot code, publish only when machine/slot ACTIVE and no other
SENT/ACKNOWLEDGED command of the machine (MachineCommandLockRepository advisory lock), result timeout from sent_at, pending timeout
(app.dispense.pending-timeout, PT120S) returning the bowl, safe vs unsafe failures, reasons and bowlCount from MachineMessageHandler,
late-result rule with audit rows, multi-bowl -> MAINTENANCE. MachineService.enterMaintenanceBySystem (audit MACHINE_MAINTENANCE_AUTO).
Domain events in dispense/event and machine/event, logged after commit only. Docs: mqtt-contract 1.1.0, mqtt-dispense.md,
machine-slot-management.md, database-migration.md, .ai/DATABASE.md §17, api.yaml (slotCode enum A/B).

Verification: `mvn clean verify` 690 tests, 0 failures. Seed and db/verify/constraints.sql pass on a throwaway V14 database.
Open: databases seeded before #52 (DEV-MACHINE-01 A1/A2/B1) stop at V14 until their slots are fixed; firmware on dev does not read
columnCode yet; BM04 is outside the repo. #47 JMeter suite still in git stash.
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
