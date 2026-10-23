# LILYGO T-Display-S3 Communication Protocol Specification

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED` & `IMPLEMENTED` (with `PROPOSED` enterprise protocol extension)

---

## 1. Implemented Serial CLI Protocol (`IMPLEMENTED`)

The firmware implements a line-oriented, deterministic command parser on the USB CDC virtual serial interface (`COM3 @ 115200 baud, 8N1`). Lines are terminated with `\n` or `\r\n`.

### 1.1 Command Set Reference

| Command | Arguments | Description | Example Response |
|---|---|---|---|
| `START` | None | Initiates automatic motion cycles based on configured counts. | `[RES] {"ok":true,"message":"Da bat dau chu ky"}` |
| `STOP` | None | Emergency Halt. Immediately detaches PWM and clamps control line to GND. | `[RES] {"ok":true,"message":"Da dung"}` |
| `OPEN` | None | Mode Mở: Rotates forward for `forwardMs`, halts, and holds opened position. | `[RES] {"ok":true,"message":"Dang mo (khong xoay ve)"}` |
| `CLOSE` | None | Mode Đóng: Rotates reverse for `reverseMs`, halts, and holds closed position. | `[RES] {"ok":true,"message":"Dang dong ve vi tri ban dau"}` |
| `TEST_FWD` | None | Bounded 500ms forward test pulse. | `[RES] {"ok":true,"message":"Test quay thuan 0.5s"}` |
| `TEST_REV` | None | Bounded 500ms reverse test pulse. | `[RES] {"ok":true,"message":"Test quay nghich 0.5s"}` |
| `CALIB <v>`| Integer (0–180) | Live stop-point testing. Attaches PWM at angle `v` without saving. | `[RES] {"ok":true,"message":"Dang test diem dung"}` |
| `CONFIG` | None | Dumps active RAM configuration. | `[CONFIG] {"servoPin":1,"servoStop":90,...}` |
| `CONFIG_SET`| Key-Value pairs | Updates configuration in RAM and persists into NVS Flash. | `[RES] {"ok":true,"message":"Da luu cau hinh"}` |
| `STATUS` | None | Requests instantaneous telemetry snapshot. | `[STATUS] {"state":"Sẵn sàng","running":false,...}` |
| `RESET` | None | Restores hardcoded factory default parameters in NVS. | `[RES] {"ok":true,"message":"Da khoi phuc mac dinh"}` |

### 1.2 Telemetry Packet Payload
When queried via `STATUS`, or broadcast periodically during active motion:

```json
[STATUS] {
  "state": "Đang quay thuận",
  "running": true,
  "cycle": 1,
  "cycles": 3,
  "servoStop": 90,
  "servoForward": 110,
  "servoReverse": 70,
  "forwardMs": 1000,
  "reverseMs": 1000,
  "pauseMs": 500,
  "ip": "192.168.4.1"
}
```

---

## 2. Implemented HTTP REST API (`IMPLEMENTED`)

The onboard `WebServer` exposes REST-equivalent endpoints over port 80:

| Endpoint | HTTP Method | Payload Format | Description |
|---|:---:|---|---|
| `/api/status` | `GET` | Empty | Returns JSON status snapshot. |
| `/api/config` | `GET` | Empty | Returns JSON hardware configuration. |
| `/api/cmd` | `POST` | `{"cmd": "START"}` | Generic CLI execution tunnel. |
| `/api/start` | `POST` | Empty | Triggers automatic motion sequence. |
| `/api/stop` | `POST` | Empty | Triggers immediate stop and line clamp. |
| `/api/open` | `POST` | Empty | Executes Mode Mở (Open & Hold). |
| `/api/close` | `POST` | Empty | Executes Mode Đóng (Close to Home). |
| `/api/reboot` | `POST` | Empty | Triggers hardware restart via ESP watchdog. |

---

## 3. Proposed Enterprise Binary Packet Framing (`PROPOSED`)

For mission-critical industrial deployments requiring guaranteed frame integrity, packet sequence validation, and cyclic redundancy checks, the following binary frame is proposed:

### 3.1 Frame Structure

```
+-----------+-----------+---------+----------+----------+-------------+----------+
|  PREAMBLE | DEVICE_ID | SEQ_NUM | MSG_TYPE | PAYLOAD  |   PAYLOAD   |  CRC16   |
| (2 Bytes) | (2 Bytes) | (2 Byt) | (1 Byte) | LEN (2B) |  (N Bytes)  | (2 Bytes)|
| 0xAA 0x55 |  0x0001   | 0x004A  |   0x01   |  0x0004  | [DATA BYTES]|  0x3F82  |
+-----------+-----------+---------+----------+----------+-------------+----------+
```

### 3.2 Message Types
*   `0x01` – `CMD_REQUEST` (Host $\rightarrow$ Device: Command payload)
*   `0x02` – `CMD_ACK` (Device $\rightarrow$ Host: Acknowledgment and return code)
*   `0x03` – `TELEMETRY_EVENT` (Device $\rightarrow$ Host: Periodic sensor / state broadcast)
*   `0x04` – `ERROR_EVENT` (Device $\rightarrow$ Host: Hardware alert or fault condition)

### 3.3 CRC16-CCITT Verification
*   **Polynomial:** $x^{16} + x^{12} + x^5 + 1$ (`0x1021`)
*   **Initial Value:** `0xFFFF`
*   Calculated across all bytes following PREAMBLE up to the final byte of PAYLOAD.
