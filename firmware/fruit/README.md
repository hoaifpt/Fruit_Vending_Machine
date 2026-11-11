# ESP32 firmware (fruit)

Two channels (see [docs/mqtt-dispense.md](../../docs/mqtt-dispense.md)):

- **Dispense over MQTT** (purchase flow): the backend publishes `{"type":"DISPENSE","commandId":"D-…"}` to
  `vending/{MACHINE_CODE}/commands`; the board answers on `vending/{MACHINE_CODE}/events` with `DISPENSE_ACCEPTED`,
  `DISPENSE_REJECTED` (busy/FAULT), then `DISPENSE_COMPLETED` or `DISPENSE_ABORTED`. It also publishes `status` (ONLINE, Last Will
  OFFLINE) and sensor events. Envelope: `{"schemaVersion":1,"messageId","machineCode","payload"}`.
- **USB Serial** (tests and calibration): the same idempotent `DISPENSE` plus `GATE`/`SERVO`/`STOP`/`RESET` (protocol below).

Both channels share one dispense entry point (`SerialCommandService::requestDispense`): a repeated commandId never moves a servo again.
A servo only moves because of a `DISPENSE`, `GATE` or `SERVO` command; the bowl sensor never starts a movement.
Without Wi-Fi/MQTT settings the firmware runs Serial-only, which is enough to test the servos.

## Wiring

| Part | ESP32 pin |
| --- | --- |
| Lower gate servo (holds the bowl in dispensing position) | GPIO 18 (servo 1) |
| Upper gate servo (holds the rest of the column) | GPIO 19 (servo 2) |
| Spare servos 3, 4 | GPIO 21, 22 (unused by default) |
| Bowl sensor (active LOW, internal pull-up) | GPIO 23 |
| Waterproof DS18B20 DATA | GPIO 4 |

Power the servos from a separate 5–6 V supply (not the ESP32 3.3 V pin, not the USB port) and connect its GND to the ESP32 GND.
Servos are continuous-rotation: 1500 µs stops, 2000 µs turns the "open" way, 1000 µs the "close" way (`include/app_config.h`).
Which servos form each gate is set by `LOWER_GATE_SERVOS` / `UPPER_GATE_SERVOS` (bit masks) in `include/app_config.h`.

The waterproof probe is a DS18B20 temperature sensor. Connect red to 3.3 V,
black to GND, yellow to GPIO 4, and add a 4.7 kOhm pull-up resistor between
DATA and 3.3 V. DS18B20 measures temperature only; it cannot measure
humidity. Each valid reading is logged as `Temperature: xx.xx C`.

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
| `DISPENSE <commandId> [A\|B]` | `ACK <id>` then `DONE <id> OK` | one full cycle (about 3.9 s) on the selected column: lower opens → bowl falls out → lower closes → upper opens → next bowl falls into position → upper closes. Omitting the column keeps the Serial compatibility default `A`. |
| | `BUSY <id> <state>` | another cycle/test is running or the controller is in FAULT |
| | `DONE <id> OK\|ABORTED` (again) | the same commandId was already executed: nothing moves (idempotent, last 8 ids) |
| `STOP` | `STOPPED` (+ `DONE <id> ABORTED`) | stops every servo; an interrupted cycle puts the controller in FAULT |
| `RESET` | `RESET OK` / `ERR NOT_IN_FAULT` | after a FAULT, once an operator has checked both gates are closed |
| `GATE <LOWER\|UPPER> <OPEN\|CLOSE>` | `OK GATE` | moves one gate with the configured pulse and time (open and close use their own times; also allowed in FAULT, to bring a gate back) |
| `SERVO <1-4> <pulseUs> <ms>` | `OK SERVO` | calibration: one servo, pulse 1000–2000 µs, 1–15000 ms, then it stops |

`commandId`: 1–39 characters `[A-Za-z0-9_-]`, unique per dispense (the kiosk should use the backend dispense command id later).

## Test with the servo (Serial Monitor)

1. `PING` → `PONG`.
2. Calibration: `SERVO 1 2000 300` (turn open for 300 ms), `SERVO 1 1000 300` (turn back). Adjust the pulse and time until the gate
   opens/closes exactly, then put the values in `SERVO_OPEN_US`, `SERVO_CLOSE_US`, `SERVO_OPEN_TIME_MS` and `SERVO_CLOSE_TIME_MS`.
3. Gates one by one: `GATE LOWER OPEN`, `GATE LOWER CLOSE`, `GATE UPPER OPEN`, `GATE UPPER CLOSE`.
   A full cycle: `DISPENSE test-001` → `ACK test-001`, lower gate then upper gate, about 3.9 s later `DONE test-001 OK`.
4. Idempotency: `DISPENSE test-001` again → `DONE test-001 OK` immediately, nothing moves.
5. Busy: `DISPENSE test-002` and immediately `DISPENSE test-003` → `BUSY test-003 ...`.
6. Emergency stop: `DISPENSE test-004`, then `STOP` → `STOPPED`, `DONE test-004 ABORTED`, `STATUS` → `STATE FAULT`;
   `DISPENSE test-005` → `BUSY`; check the gates, `RESET` → `RESET OK`.
7. Sensor: trigger GPIO 23 → log `# Bowl sensor triggered`, no servo moves.

## MQTT test (optional)

Backend repo: create machine `FV-DEV-001`, start the broker (`infra/mosquitto`, reachable from the LAN) and the backend with
the machine broker password. Expected: `# MQTT connected as FV-DEV-001`; the backend receives `status` ONLINE at every connect,
`events` DISPENSE_COMPLETED / DISPENSE_ABORTED / BOWL_SENSOR_TRIGGERED, and `status` OFFLINE (Last Will) when the board loses power.
Telemetry starts after DS18B20 initialization. The MQTT telemetry payload is
`{"temperature":23.50,"humidity":null}`. A separate humidity-capable sensor is
required if the backend needs humidity values.

### Captive portal cấu hình

Thiết bị lưu cấu hình Wi-Fi/MQTT vào NVS của ESP32. Khi chưa có SSID hoặc kết nối
Wi-Fi thất bại sau 15 giây, máy phát Access Point `FreshVend-Setup`. Kết nối điện
thoại vào AP và mở `http://192.168.4.1` để nhập SSID/mật khẩu Wi-Fi, MQTT host/port,
machine code và MQTT password. Sau khi lưu, máy tự khởi động lại.

Các giá trị `APP_WIFI_SSID`, `APP_WIFI_PASSWORD`, `APP_MQTT_HOST`, `APP_MACHINE_CODE`
trong `include/secrets.h` (nếu có) chỉ được dùng làm fallback cho lần khởi động đầu tiên.

## Maintenance operations

Maintenance is separate from `DISPENSE` and supports two operations on the
selected column (`A` or `B`):

- `MAINTENANCE_REMOVE_ITEM`: opens the lower gate briefly so staff can remove
  one item, then opens and closes the upper gate to move the next item into
  position.
- `MAINTENANCE_EMPTY_COLUMN`: opens the lower gate for the configured
  whole-column hold time so staff can remove all items. The upper gate is not
  opened because the column is intentionally emptied.

Both commands use the same MQTT topic and require `commandId` and `columnCode`.
The firmware publishes operation-specific `ACCEPTED`, `REJECTED`,
`COMPLETED`, or `ABORTED` events. Repeating a completed commandId publishes
the result again without moving the servos. A column operation is rejected
while the controller is busy or faulted.

MQTT `DISPENSE` also requires `columnCode`:

```json
{
  "type": "DISPENSE",
  "commandId": "ORDER-001",
  "columnCode": "B"
}
```

Column A maps to the lower/upper servo masks `0b0001`/`0b0010`; column B maps
to `0b0100`/`0b1000`. The firmware rejects a MQTT dispense command without a
single-character column code.
