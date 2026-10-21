# ESP32 firmware (fruit)

Two channels, as in the approved architecture:

- **Dispense**: kiosk/tablet → USB Serial → ESP32 → servos (`SerialCommandService`, draft protocol below).
  A servo only moves because of a `DISPENSE`, `GATE` or `SERVO` command; the bowl sensor never starts a movement.
- **MQTT** (optional, publish only): `vending/{MACHINE_CODE}/status|events|telemetry` with the JSON envelope of the
  backend contract `api-contract/mqtt-contract.md` (schemaVersion 1). No command topic is subscribed.

Without Wi-Fi/MQTT settings the firmware runs Serial-only, which is enough to test the servos.

## Wiring

| Part | ESP32 pin |
| --- | --- |
| Lower gate servo (holds the bowl in dispensing position) | GPIO 18 (servo 1) |
| Upper gate servo (holds the rest of the column) | GPIO 19 (servo 2) |
| Spare servos 3, 4 | GPIO 21, 22 (unused by default) |
| Bowl sensor (active LOW, internal pull-up) | GPIO 23 |

Power the servos from a separate 5–6 V supply (not the ESP32 3.3 V pin, not the USB port) and connect its GND to the ESP32 GND.
Servos are continuous-rotation: 1500 µs stops, 2000 µs turns the "open" way, 1000 µs the "close" way (`include/app_config.h`).
Which servos form each gate is set by `LOWER_GATE_SERVOS` / `UPPER_GATE_SERVOS` (bit masks) in `include/app_config.h`.

## Build and flash

```bash
pio run -t upload
pio device monitor -b 115200
```

Optional: copy `include/secrets.h.example` to `include/secrets.h` (ignored by Git) for Wi-Fi/MQTT.

## Serial protocol (draft)

Send one command per line (`\n`). Lines starting with `# ` are logs. At boot the board prints `READY <fw> <machineCode>`.

| Request | Reply | Meaning |
| --- | --- | --- |
| `PING` | `PONG` | link check |
| `STATUS` | `STATE <state> [<commandId>]` | IDLE, OPENING_LOWER, HOLD_LOWER, CLOSING_LOWER, OPENING_UPPER, HOLD_UPPER, CLOSING_UPPER, MANUAL_MOVE, FAULT |
| `DISPENSE <commandId>` | `ACK <id>` then `DONE <id> OK` | one full cycle (about 2.6 s): lower opens → bowl falls out → lower closes → upper opens → next bowl falls into position → upper closes. The two gates are never open together |
| | `BUSY <id> <state>` | another cycle/test is running or the controller is in FAULT |
| | `DONE <id> OK\|ABORTED` (again) | the same commandId was already executed: nothing moves (idempotent, last 8 ids) |
| `STOP` | `STOPPED` (+ `DONE <id> ABORTED`) | stops every servo; an interrupted cycle puts the controller in FAULT |
| `RESET` | `RESET OK` / `ERR NOT_IN_FAULT` | after a FAULT, once an operator has checked both gates are closed |
| `GATE <LOWER\|UPPER> <OPEN\|CLOSE>` | `OK GATE` | moves one gate with the configured pulse and time (also allowed in FAULT, to bring a gate back) |
| `SERVO <1-4> <pulseUs> <ms>` | `OK SERVO` | calibration: one servo, pulse 1000–2000 µs, 1–15000 ms, then it stops |

`commandId`: 1–39 characters `[A-Za-z0-9_-]`, unique per dispense (the kiosk should use the backend dispense command id later).

## Test with the servo (Serial Monitor)

1. `PING` → `PONG`.
2. Calibration: `SERVO 1 2000 300` (turn open for 300 ms), `SERVO 1 1000 300` (turn back). Adjust the pulse and time until the gate
   opens/closes exactly, then put the values in `SERVO_OPEN_US`, `SERVO_CLOSE_US` and `SERVO_MOVE_TIME_MS`.
3. Gates one by one: `GATE LOWER OPEN`, `GATE LOWER CLOSE`, `GATE UPPER OPEN`, `GATE UPPER CLOSE`.
   A full cycle: `DISPENSE test-001` → `ACK test-001`, lower gate then upper gate, about 2.6 s later `DONE test-001 OK`.
4. Idempotency: `DISPENSE test-001` again → `DONE test-001 OK` immediately, nothing moves.
5. Busy: `DISPENSE test-002` and immediately `DISPENSE test-003` → `BUSY test-003 ...`.
6. Emergency stop: `DISPENSE test-004`, then `STOP` → `STOPPED`, `DONE test-004 ABORTED`, `STATUS` → `STATE FAULT`;
   `DISPENSE test-005` → `BUSY`; check the gates, `RESET` → `RESET OK`.
7. Sensor: trigger GPIO 23 → log `# Bowl sensor triggered`, no servo moves.

## MQTT test (optional)

Backend repo: create machine `FV-DEV-001`, start the broker (`infra/mosquitto`, reachable from the LAN) and the backend with
`MQTT_ENABLED=true` (see `docs/mqtt-integration.md`). In `secrets.h` set Wi-Fi, `APP_MQTT_HOST` (computer IP), `APP_MACHINE_CODE`
and the machine broker password. Expected: `# MQTT connected as FV-DEV-001`; the backend receives `status` ONLINE at every connect,
`events` DISPENSE_COMPLETED / DISPENSE_ABORTED / BOWL_SENSOR_TRIGGERED, and `status` OFFLINE (Last Will) when the board loses power.
Telemetry starts once a temperature/humidity sensor is added (`MqttService::publishTelemetry`).
