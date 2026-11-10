# MQTT Contract — Backend ↔ Vending Machines

```text
Contract version:        1.1.0
Envelope schemaVersion:  1
Source of truth for:     topics, envelope, commands, events, payloads, timings, error codes, broker security
Examples (fixtures):     api-contract/mqtt/examples/*.json
REST contract:           api-contract/api.yaml
```

Status of each message:

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | sent and handled by both backend and firmware |
| `BACKEND_PENDING` | firmware implements it; the backend does not send / handle it yet |
| `FIRMWARE_PENDING` | the backend side is defined; the firmware does not send / handle it yet |
| `PLANNED` | agreed shape, implemented by neither side yet |

The issue in brackets (3.3, 3.4, …) is the backlog item that implements the missing side.

Reference implementations (statuses refer to `dev`): backend `backend/src/main/java/com/fruitmachine/backend/mqtt/` (constants in
`mqtt/contract/`), firmware `firmware/fruit/` v0.3.0 on `dev` (`src/services/MqttService.cpp`, `src/main.cpp`, `include/app_config.h`).
The unmerged branch `feature/firmware-staff-refill-and-maintenance` (737b7b9) already implements `columnCode`, heartbeat and the maintenance commands
in its firmware; until it is merged into `dev` those items stay pending here.

## Change log

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-11-09 | First publication (issue #49). Replaces the message definitions in `docs/`. |
| 1.1.0 | 2026-11-10 | Issue #52: the backend sends `columnCode` and handles `details.reason` / `details.bowlCount`; separate result and pending timeouts; one in-flight command per machine; late-result rule. No message shape changed. |

## Versioning rules

```text
add an optional field, a new event type or a new error code   → minor version (1.x.0), schemaVersion unchanged
remove or rename anything, change a meaning or a required field → new schemaVersion (major version)
the meaning of a published error code never changes; retired codes are never reused
```

Receivers ignore unknown optional fields and unknown event types (forward compatibility).

---

## 1. Topics

Topic root: `vending` (backend `MQTT_TOPIC_ROOT`, firmware `AppConfig::MQTT_TOPIC_ROOT`).
`{machineCode}` = the machine's `code` in the backend = its broker username = its MQTT client id.

| Channel | Topic | Direction | Purpose | Status |
| --- | --- | --- | --- | --- |
| `commands` | `vending/{machineCode}/commands` | backend → machine | dispense, maintenance and reset commands | IMPLEMENTED (DISPENSE) |
| `events` | `vending/{machineCode}/events` | machine → backend | command results, sensor events, faults, boot | IMPLEMENTED (DISPENSE_*) |
| `status` | `vending/{machineCode}/status` | machine → backend | `ONLINE` on connect, `OFFLINE` as Last Will | IMPLEMENTED (backend records `last_seen_at` only; state handling 3.4) |
| `heartbeat` | `vending/{machineCode}/heartbeat` | machine → backend | liveness and diagnostics every 30 s | PLANNED (backend 3.4; firmware on the unmerged firmware branch) |
| `telemetry` | `vending/{machineCode}/telemetry` | machine → backend | temperature / humidity | FIRMWARE_PENDING (no sensor yet) |

Rules:

```text
exactly 3 levels <root>/<machineCode>/<channel>; any other topic is dropped
machine code: uppercase, exactly as registered in the backend (e.g. FV-DEV-001)
no other topics; payment, order and dispense decisions are never taken outside these messages
the backend subscribes to vending/+/events and vending/+/status (QoS 1); heartbeat and telemetry are added in 3.4
```

## 2. Envelope

Every message, in both directions:

```json
{
  "schemaVersion": 1,
  "messageId": "a1b2c3d4-17",
  "machineCode": "FV-DEV-001",
  "payload": { }
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion` | yes | integer `1` |
| `messageId` | yes | non-blank, at most 64 characters, unique per sender (backend: UUID; firmware: `<8-hex boot id>-<sequence>`) |
| `machineCode` | yes | equals the machine code of the topic, otherwise the message is dropped |
| `payload` | yes | JSON object, shape defined per channel below |

- There is no device timestamp. The backend always uses its own receive time (the ESP32 has no reliable clock).
- Current backend tolerance (no change before 3.3): a message without `machineCode` is treated as the topic's machine;
  `schemaVersion` and `messageId` are not validated yet. A `machineCode` that differs from the topic is always dropped.
- Current firmware tolerance: a command without `machineCode` is accepted as its own; `schemaVersion` is not checked yet
  (`UNSUPPORTED_SCHEMA`, PLANNED).
- Malformed JSON is logged and dropped by both sides, never retried and never allowed to stop the MQTT client.

---

## 3. Commands (backend → machine, `commands`)

QoS 1, not retained. The firmware runs one command at a time; a command that arrives while another one runs is rejected.
`commandId`: 1–39 characters `[A-Za-z0-9_-]` (firmware buffer limit). `columnCode`: `"A"` or `"B"` (slot code of the column).

Hardware: column A = servo 1 (lower gate) + servo 2 (upper gate); column B = servo 3 (lower) + servo 4 (upper).
The bowl in selling position rests on the lower gate; the rest of the column rests on the upper gate.
Gate timings (`include/app_config.h`): open 600 ms, close 700 ms; the two gates of a column are never open at the same time.

| Command type | Payload | Status |
| --- | --- | --- |
| `DISPENSE` | `{"type":"DISPENSE","commandId":"D-…","columnCode":"B"}` | IMPLEMENTED; `columnCode` FIRMWARE_PENDING (backend sends it since #52; firmware on `dev` reads `column`/`slot`) |
| `MAINTENANCE_REMOVE_ITEM` | `{"type":"MAINTENANCE_REMOVE_ITEM","commandId":"MC-…","columnCode":"A"}` | PLANNED (backend 4.2; firmware on the unmerged firmware branch) |
| `MAINTENANCE_EMPTY_COLUMN` | `{"type":"MAINTENANCE_EMPTY_COLUMN","commandId":"MC-…","columnCode":"A"}` | PLANNED (backend 4.2; firmware on the unmerged firmware branch) |
| `MAINTENANCE_OPEN_REFILL` | `{"type":"MAINTENANCE_OPEN_REFILL","commandId":"MC-…","columnCode":"A"}` | PLANNED (backend 4.2; firmware on the unmerged firmware branch) |
| `MAINTENANCE_CLOSE_REFILL` | `{"type":"MAINTENANCE_CLOSE_REFILL","commandId":"MC-…","columnCode":"A"}` | PLANNED (backend 4.2; firmware on the unmerged firmware branch) |
| `RESET` | `{"type":"RESET","commandId":"RS-…"}` | PLANNED (firmware + 4.2) |

### 3.1 DISPENSE

```text
commandId   backend format D-<16 uppercase hex>, one per paid bowl
columnCode  "A" | "B" = slot code of the reserved bowl (slot codes are restricted to A/B since V14). The backend sends it
            on every publish (#52). The firmware on dev still reads payload.column (1 | 2) or payload.slot ("B" or "2" →
            column 2) and uses column 1 (A) when neither is given (columnCode: FIRMWARE_PENDING)
            an invalid columnCode will be rejected with INVALID_COLUMN (PLANNED in firmware; handled by the backend)
publish     only while the machine and the slot are ACTIVE and no other command of the machine is SENT/ACKNOWLEDGED;
            otherwise the command waits PENDING (not counted as a delivery attempt)
cycle       (dev) upper gate locked 250 ms → lower opens 600 ms → hold 700 ms (bowl falls out) → lower closes 700 ms
            → pause 3000 ms → upper opens 600 ms → hold 700 ms (next bowl falls into position) → upper closes 700 ms   ≈ 7.3 s
```

### 3.2 Maintenance

| Command type | Physical cycle (`app_config.h` of the firmware branch 737b7b9) |
| --- | --- |
| `MAINTENANCE_REMOVE_ITEM` | lower opens → hold `MAINTENANCE_REMOVE_ITEM_HOLD_MS` 1200 ms (staff takes the bottom bowl) → lower closes → upper opens → hold `REFILL_HOLD_MS` 700 ms (next bowl falls into position) → upper closes |
| `MAINTENANCE_EMPTY_COLUMN` | lower opens → hold `MAINTENANCE_EMPTY_COLUMN_HOLD_MS` 5000 ms (every bowl falls out) → lower closes; the upper gate does not move |
| `MAINTENANCE_OPEN_REFILL` | upper opens and **stays open** (staff drops the first bowl into selling position) |
| `MAINTENANCE_CLOSE_REFILL` | upper closes (staff then fills the rest of the column on top of it) |

Backend rules (recorded here, implemented in 4.2):

```text
REMOVE_ITEM releases the BOTTOM bowl of the column → the backend removes the slot head, never a staff-chosen item
EMPTY_COLUMN releases every bowl → AVAILABLE, EXPIRED and DISPENSE_FAILED bowls become REMOVED
inventory changes only after *_COMPLETED, never after *_ACCEPTED
maintenance commands only while the machine is MAINTENANCE; one command per machine at a time
```

### 3.3 RESET

Clears the controller FAULT remotely after an operator checked the gates. ADMIN only, machine MAINTENANCE.
Today RESET exists only as a Serial command for the technician.

---

## 4. Events (machine → backend, `events`)

Payload shape:

```json
{ "eventType": "DISPENSE_COMPLETED", "details": { "commandId": "D-…", "columnCode": "B" } }
```

Unknown `eventType` values are logged and ignored by the backend.

### 4.1 Command lifecycle

Each command answers with `<prefix><phase>`. The firmware answers a resend of a running command with `ACCEPTED` and a resend
of a finished one with its remembered result (last 8 command IDs, in RAM).

| Command type | Event prefix | Phases | Status |
| --- | --- | --- | --- |
| `DISPENSE` | `DISPENSE_` | ACCEPTED, REJECTED, COMPLETED, ABORTED | IMPLEMENTED |
| `MAINTENANCE_REMOVE_ITEM` | `MAINTENANCE_REMOVE_ITEM_` | ACCEPTED, REJECTED, COMPLETED, ABORTED | PLANNED (backend 4.2; firmware on the unmerged firmware branch) |
| `MAINTENANCE_EMPTY_COLUMN` | `MAINTENANCE_EMPTY_COLUMN_` | ACCEPTED, REJECTED, COMPLETED, ABORTED | PLANNED (backend 4.2; firmware on the unmerged firmware branch) |
| `MAINTENANCE_OPEN_REFILL` | `MAINTENANCE_OPEN_REFILL_` | ACCEPTED, REJECTED, COMPLETED, ABORTED | PLANNED (backend 4.2; firmware on the unmerged firmware branch) |
| `MAINTENANCE_CLOSE_REFILL` | `MAINTENANCE_CLOSE_REFILL_` | ACCEPTED, REJECTED, COMPLETED, ABORTED | PLANNED (backend 4.2; firmware on the unmerged firmware branch) |
| `RESET` | `RESET_` | ACCEPTED, REJECTED | PLANNED |

| Phase | Meaning | `details` today | `details` planned |
| --- | --- | --- | --- |
| `ACCEPTED` | command started (or resend of the running command) | `commandId`, `column` (number) | `commandId`, `columnCode` (+ `operation` for maintenance) |
| `REJECTED` | not started | `commandId`, `state` (controller state, e.g. `HOLD_LOWER`, `FAULT`) | + `columnCode`, `reason` (§6.1) |
| `COMPLETED` | cycle finished | `commandId` (+ `column` when answering a resend) | + `columnCode`, `operation`; `bowlCount` for dispense (FIRMWARE_PENDING) |
| `ABORTED` | cycle stopped (STOP, fault) | `commandId` (+ `column` when answering a resend) | + `columnCode`, `operation`, `reason` (§6.1) |

`operation` is the command type without `MAINTENANCE_` (`REMOVE_ITEM`, `EMPTY_COLUMN`, `OPEN_REFILL`, `CLOSE_REFILL`).

Backend handling of the dispense lifecycle (implemented, #52):

```text
DISPENSE_ACCEPTED   command SENT → ACKNOWLEDGED, order DISPENSING
DISPENSE_COMPLETED  command SUCCESS, bowl SOLD, order COMPLETED
                    bowlCount > 1 or reason MULTIPLE_BOWLS_DETECTED → also machine MAINTENANCE (other bowls are not guessed)
DISPENSE_REJECTED   no reason, BUSY or an unknown reason → command stays open and is resent (firmware v0.3.0 compatible)
                    CONTROLLER_FAULT, INVALID_COMMAND_ID, INVALID_COLUMN, UNSUPPORTED_SCHEMA → safe failure: command FAILED,
                    bowl AVAILABLE again (RETURN history), allocation RELEASED, order DISPENSE_FAILED;
                    CONTROLLER_FAULT also puts the machine in MAINTENANCE, the others are logged as backend ERROR
                    (after ACCEPTED, "not started" contradicts the machine: treated as unsafe)
DISPENSE_ABORTED    any reason or none → unsafe failure: command FAILED (reason, else ABORTED_UNSPECIFIED),
                    bowl DISPENSE_FAILED (blocks its column), order DISPENSE_FAILED, machine MAINTENANCE, never resent
```

`dispense_commands.failure_reason` stores the reason of every FAILED/TIMEOUT command: the machine reasons above, or the backend
values `RESULT_TIMEOUT`, `NOT_DELIVERED` and `LEGACY_UNKNOWN` (rows from before V14).

### 4.2 Other events

| Event type | Meaning | `details` | Status |
| --- | --- | --- | --- |
| `BOWL_SENSOR_TRIGGERED` | the IR sensor saw a bowl pass (information, not an error) | `dispenseState` | BACKEND_PENDING (3.5) — firmware sends it, backend ignores it |
| `FAULT` | hardware fault | `code` (§6.2), optional `state`, `columnCode` | PLANNED |
| `FAULT_CLEARED` | the fault was cleared by RESET | `code` | PLANNED |
| `BOOT` | the device started | `resetReason` (§6.3), `firmwareVersion` | PLANNED |

---

## 5. Status, Heartbeat, Telemetry

### 5.1 `status`

```json
{ "state": "ONLINE", "firmwareVersion": "0.3.0", "uptimeSeconds": 12 }
{ "state": "OFFLINE" }
```

`ONLINE` is published right after every (re)connect. `OFFLINE` is the Last Will registered at connect (QoS 1, not retained)
and published by the broker when the machine disappears; it carries a full envelope with `messageId` `lwt-<boot id>`.

### 5.2 `heartbeat` (every 30 s) — PLANNED (backend 3.4; firmware on the unmerged firmware branch)

```json
{ "state": "ONLINE", "uptimeSeconds": 12345, "wifiRssi": -55, "freeHeap": 18240, "firmwareVersion": "0.3.0" }
```

```text
required: state, uptimeSeconds, firmwareVersion
optional: wifiRssi (dBm), freeHeap (bytes) → a missing value is stored as null, never 0
also sent once right after each connect
```

### 5.3 `telemetry` (FIRMWARE_PENDING)

```json
{ "temperature": 4.7, "humidity": 68.2 }
```

```text
°C and %RH, one decimal; recommended interval 60 s
sensor unreadable → FAULT event TEMP_SENSOR_ERROR, no telemetry message (never 0, NaN or a fake value)
```

---

## 6. Error Code Catalog

Catalog status: `AGREED` (backend and firmware signed off) or `PROPOSED`. A code becomes `AGREED` only after the firmware
owner confirms it in the discussion of issue #49. Every code below is `PROPOSED` until that confirmation: the firmware does
not send `reason`, `FAULT` or `BOOT` yet (today a rejection carries only the controller `state`).

### 6.1 `details.reason` on `*_REJECTED` / `*_ABORTED`

| Reason | Catalog | When | Backend action (issue) |
| --- | --- | --- | --- |
| `BUSY` | PROPOSED — awaiting firmware sign-off | another command is running | keep the command open and resend (implemented) |
| `CONTROLLER_FAULT` | PROPOSED — awaiting firmware sign-off | controller in FAULT | REJECTED: bowl returned, machine MAINTENANCE (implemented #52); HARDWARE_FAULT alert (3.6) |
| `INVALID_COMMAND_ID` | PROPOSED — awaiting firmware sign-off | commandId empty, too long or bad characters | REJECTED: bowl returned, log ERROR, no resend (implemented #52) |
| `INVALID_COLUMN` | PROPOSED — awaiting firmware sign-off | columnCode not A/B | REJECTED: bowl returned, log ERROR, no resend (implemented #52) |
| `UNSUPPORTED_SCHEMA` | PROPOSED — awaiting firmware sign-off | unknown schemaVersion | REJECTED: bowl returned, log ERROR, no resend (implemented #52) |
| `MANUAL_STOP` | PROPOSED — awaiting firmware sign-off | technician STOP over Serial | ABORTED: command FAILED, bowl DISPENSE_FAILED, machine MAINTENANCE (implemented #52) |
| `NO_BOWL_DETECTED` | PROPOSED — awaiting firmware sign-off | cycle done, IR counted 0 bowls | ABORTED: FAILED; order DISPENSE_FAILED; machine MAINTENANCE (implemented #52) |
| `MULTIPLE_BOWLS_DETECTED` | PROPOSED — awaiting firmware sign-off | IR counted more than 1 bowl | COMPLETED: SUCCESS for this bowl; machine MAINTENANCE (implemented #52); CRITICAL alert (3.6); staff reconciles stock |
| `INTERRUPTED_BY_REBOOT` | PROPOSED — awaiting firmware sign-off | reboot during a command (from NVS) | ABORTED: unsafe failure, never resent (implemented #52) |

### 6.2 `FAULT` event `details.code`

| Code | Catalog | Severity | When | Backend action |
| --- | --- | --- | --- | --- |
| `SERVO_INIT_FAILED` | PROPOSED — awaiting firmware sign-off | CRITICAL | servo driver failed at boot; firmware enters FAULT | machine MAINTENANCE + alert |
| `GATE_POSITION_UNKNOWN` | PROPOSED — awaiting firmware sign-off | CRITICAL | a gate may not be closed after an abort | machine MAINTENANCE + alert |
| `CONTROLLER_FAULT` | PROPOSED — awaiting firmware sign-off | CRITICAL | controller entered FAULT (`details.state`) | machine MAINTENANCE + alert |
| `IR_SENSOR_STUCK` | PROPOSED — awaiting firmware sign-off | WARNING | IR active longer than the threshold | alert; block sales until checked |
| `IR_SENSOR_DISCONNECTED` | PROPOSED — awaiting firmware sign-off | WARNING | no IR pulse over several dispense cycles | alert; block sales until checked |
| `UNEXPECTED_BOWL_DETECTED` | PROPOSED — awaiting firmware sign-off | WARNING | IR triggered while idle | alert; stock reconciliation |
| `TEMP_SENSOR_ERROR` | PROPOSED — awaiting firmware sign-off | WARNING | temperature/humidity sensor unreadable | alert; skip temperature evaluation |

### 6.3 `BOOT` event `details.resetReason`

| Reset reason | Catalog | Backend action |
| --- | --- | --- |
| `POWERON` | PROPOSED — awaiting firmware sign-off | none |
| `SOFTWARE` | PROPOSED — awaiting firmware sign-off | none |
| `WATCHDOG` | PROPOSED — awaiting firmware sign-off | WARNING alert (3.6) |
| `PANIC` | PROPOSED — awaiting firmware sign-off | WARNING alert (3.6) |
| `BROWNOUT` | PROPOSED — awaiting firmware sign-off | WARNING alert (3.6) |
| `UNKNOWN` | PROPOSED — awaiting firmware sign-off | none |

The values map from the ESP32 `esp_reset_reason()` result; every other value is reported as `UNKNOWN`.

### 6.4 Not part of the catalog

```text
Serial "ERR ..." replies and Logger output → local debugging only, never sent over MQTT
Wi-Fi / MQTT connection loss → inferred by the backend (no message for 180 s, Last Will) → MACHINE_OFFLINE alert (3.4, 3.6)
```

---

## 7. Delivery Semantics

| Rule | Value |
| --- | --- |
| Command QoS | 1, not retained |
| Machine → backend QoS | 0 today (PubSubClient publishes QoS 0); 1 when the library allows it; Last Will QoS 1 |
| Backend subscription QoS | 1 |
| Dispense resend | same commandId every 5 s (`DISPENSE_RESEND_AFTER`) while PENDING/SENT without an answer |
| Dispense result timeout | 60 s (`DISPENSE_TIMEOUT`) after the **first delivery** (`sent_at`; resends do not move it) → TIMEOUT `RESULT_TIMEOUT`, bowl DISPENSE_FAILED, order DISPENSE_FAILED, machine MAINTENANCE |
| Dispense pending timeout | 120 s (`DISPENSE_PENDING_TIMEOUT`) after creation without any delivery → FAILED `NOT_DELIVERED`, bowl AVAILABLE again, order DISPENSE_FAILED |
| Maintenance timeouts | ACCEPTED within 30 s, COMPLETED within 90 s (4.2) |
| One command per machine | firmware runs one command and rejects others; the backend publishes a command only when no other command of the machine is SENT/ACKNOWLEDGED, under a per-machine advisory lock (implemented #52) |
| Duplicate commands | the firmware never runs a commandId twice: last 8 IDs in RAM today; persisting done IDs in **NVS** is FIRMWARE_PENDING |
| Duplicate events | the backend processes events idempotently by commandId + state (`DUPLICATE`) |
| Late `DISPENSE_COMPLETED` after FAILED/TIMEOUT | implemented (#52), only while the bowl is still DISPENSE_FAILED: order DISPENSE_FAILED → SUCCESS, bowl SOLD, order COMPLETED, machine stays MAINTENANCE; order REFUNDED → bowl SOLD, order stays REFUNDED, audit `DISPENSE_SUCCESS_AFTER_REFUND`; otherwise (bowl returned, removed or sold) nothing changes, audit `DISPENSE_LATE_RESULT_CONFLICT` |
| Success confirmation | `DISPENSE_COMPLETED` only when the IR sensor counted exactly one bowl (FIRMWARE_PENDING) |
| Heartbeat interval | 30 s |
| Offline threshold | 180 s without status, heartbeat or event (3.4) |
| `last_seen_at` | updated by the backend on every accepted message (implemented) |

---

## 8. Security

```text
one broker account per machine (username = machine code) + one backend account; anonymous access denied
ACL (infra/mosquitto/acl):
  backend   readwrite vending/#
  machine   read  vending/{own}/commands
            write vending/{own}/events | status | heartbeat | telemetry
the topic machine code is trusted only because of the ACL; the envelope machineCode must match it
TLS (8883) on staging and production → 3.7 + firmware (WiFiClientSecure); the local broker on 1883 is for a trusted LAN only
no credentials, real machine codes or secrets in examples, logs or Git (passwd and secrets.h are ignored by Git)
```

Accounts are created with `infra/mosquitto/add-user.ps1 <user>`; see `infra/mosquitto/README.md`.

---

## 9. Examples

`api-contract/mqtt/examples/` holds one full envelope per message type (fake machine code `FV-DEV-001`, fake IDs).
The file name prefix gives the channel: `command-` → `commands`, `event-` → `events`, `status-`, `heartbeat`, `telemetry`.
Backend tests parse every example on each build; the firmware team may use them as test fixtures.

| File | Message | Status |
| --- | --- | --- |
| `command-dispense.json` | DISPENSE with `columnCode` | IMPLEMENTED (`columnCode` FIRMWARE_PENDING) |
| `command-maintenance-remove-item.json` | MAINTENANCE_REMOVE_ITEM | PLANNED |
| `event-dispense-accepted.json` | DISPENSE_ACCEPTED | IMPLEMENTED |
| `event-dispense-completed.json` | DISPENSE_COMPLETED | IMPLEMENTED |
| `event-dispense-aborted-no-bowl.json` | DISPENSE_ABORTED with reason NO_BOWL_DETECTED | IMPLEMENTED (reason PLANNED) |
| `event-dispense-rejected-busy.json` | DISPENSE_REJECTED with reason BUSY | IMPLEMENTED (reason PLANNED) |
| `event-fault-servo-init-failed.json` | FAULT SERVO_INIT_FAILED | PLANNED |
| `event-boot.json` | BOOT | PLANNED |
| `status-online.json` | status ONLINE | IMPLEMENTED |
| `status-offline-lwt.json` | status OFFLINE (Last Will) | IMPLEMENTED |
| `heartbeat.json` | heartbeat | PLANNED |
| `telemetry.json` | telemetry | FIRMWARE_PENDING |
