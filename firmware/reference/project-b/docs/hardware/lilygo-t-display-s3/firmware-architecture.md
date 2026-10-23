# LILYGO T-Display-S3 Firmware Architecture & Lifecycle

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED` & `IMPLEMENTED` (with `PROPOSED` modular roadmap)

---

## 1. System Responsibility Boundaries

The overall IoT control architecture consists of three distinct tiers. Maintaining clean functional boundaries prevents the firmware from becoming an unmaintainable monolithic subsystem.

```
+---------------------------------------------------------------+
|                       Tier 1: Frontend                        |
|  - Modern Web UI (Desktop & Mobile Responsive)                |
|  - User controls, motion triggering, visual dashboard         |
|  - Real-time gauge rendering & live telemetry                 |
+---------------------------------------------------------------+
                               |
                               | HTTP REST / WebSockets
                               v
+---------------------------------------------------------------+
|                   Tier 2: Host / Backend Bridge               |
|  - Python server.py (or Node.js daemon)                       |
|  - Serial port arbitration (COM3 @ 115200)                    |
|  - Telemetry broadcast, data aggregation, authentication      |
|  - Logging, crash capture, multi-client fan-out               |
+---------------------------------------------------------------+
                               |
                               | Hardware Serial / USB CDC Protocol
                               v
+---------------------------------------------------------------+
|                 Tier 3: ESP32-S3 Firmware                     |
|  - Deterministic real-time actuator control                   |
|  - Microsecond PWM pulse generation (LEDC Timer)              |
|  - Hardware ground clamping & anti-drift protection           |
|  - 1.9" ST7789 parallel LCD status visualization              |
|  - Non-blocking motion state machine                          |
|  - Non-volatile configuration storage (NVS Flash)             |
+---------------------------------------------------------------+
```

> [!IMPORTANT]
> **Core Principle:** The ESP32 firmware must **NOT** become a second backend. Complex business logic, database queries, long-term history logging, and heavy data parsing belong on Tier 2. The microcontroller focuses strictly on real-time deterministic hardware tasks.

---

## 2. Implemented Motion State Machine (`IMPLEMENTED`)

The motion controller in [ESP32_Control_Center_ServoStop_FIXED_v2.ino](../../../ESP32_Control_Center_ServoStop_FIXED_v2.ino) uses a non-blocking, timer-driven state machine evaluated on every iteration of `loop()` via `updateMotion()`:

```
                          +-------------------+
                          |    STATE_IDLE     |
                          |   ("Sẵn sàng")    |
                          +-------------------+
                             |     |       |
                Command:     |     |       |   Command:
                "START"      |     |       |   "OPEN"
                             v     |       v
               +---------------+   |   +---------------+
               | STATE_FORWARD |   |   | STATE_OPENING |
               | (forwardMs)   |   |   | (forwardMs)   |
               +---------------+   |   +---------------+
                       |           |           |
                       v           |           v
               +---------------+   |   +---------------+
               | STATE_PAUSE1  |   |   | STATE_OPENED  |
               | (pauseMs)     |   |   | (Holding Pos) |
               +---------------+   |   +---------------+
                       |           |           |
                       v           |           | Command:
               +---------------+   |           | "CLOSE"
               | STATE_REVERSE |   |           v
               | (reverseMs)   |   |   +---------------+
               +---------------+   |   | STATE_CLOSING |
                       |           |   | (reverseMs)   |
                       v           |   +---------------+
               +---------------+   |           |
               | STATE_PAUSE2  |   |           v
               | (pauseMs)     |   |   +---------------+
               +---------------+   |   | STATE_CLOSED  |
                       |           |   | (Initial Pos) |
                       v           |   +---------------+
               +---------------+   |           |
               | STATE_COMPLETE|---+           |
               +---------------+               |
                       ^                       |
                       |      Command: "STOP"  |
                       +-----------------------+
```

### State Definitions & Hardware Actuation

| State Constant | Vietnamese UI Text | PWM Output | Control Pin Clamp | Duration Condition |
|---|---|---|---|---|
| `STATE_IDLE` | `"Sẵn sàng"` | Detached | Pin 1 held **LOW** | Indefinite (Awaits command) |
| `STATE_FORWARD` | `"Đang quay thuận"` | `servoForward` (110°) | LEDC active | `millis() - timer >= forwardMs` |
| `STATE_PAUSE1` | `"Đang dừng"` | Detached | Pin 1 clamped **LOW** | `millis() - timer >= pauseMs` |
| `STATE_REVERSE` | `"Đang quay nghịch"`| `servoReverse` (70°) | LEDC active | `millis() - timer >= reverseMs` |
| `STATE_PAUSE2` | `"Đang dừng"` | Detached | Pin 1 clamped **LOW** | `millis() - timer >= pauseMs` |
| `STATE_COMPLETE` | `"Hoàn thành"` | Detached | Pin 1 clamped **LOW** | Cycles completed $\rightarrow$ IDLE |
| `STATE_OPENING` | `"Đang mở"` | `servoForward` (110°) | LEDC active | `millis() - timer >= forwardMs` |
| `STATE_OPENED` | `"Đã mở"` | Detached | Pin 1 clamped **LOW** | Indefinite (Holds open position) |
| `STATE_CLOSING` | `"Đang đóng"` | `servoReverse` (70°) | LEDC active | `millis() - timer >= reverseMs` |
| `STATE_CLOSED` | `"Đã đóng"` | Detached | Pin 1 clamped **LOW** | Indefinite (Holds closed position)|
| `STATE_STOPPED` | `"Dừng khẩn cấp"` | Detached | Pin 1 clamped **LOW** | Forced on `STOP` command |

---

## 3. Proposed Future Modular Architecture (`PROPOSED`)

The existing codebase operates reliably as a consolidated `.ino` file with an extracted `web_ui.h` header. As feature complexity grows, future iterations should transition into a modular layout:

```
firmware/
├── platformio.ini               # Build flags & library dependencies
├── include/
│   └── web_ui.h                 # Extracted web bundle (HTML/CSS/JS in PROGMEM)
└── src/
    ├── main.cpp                 # Root entrypoint (setup & loop)
    ├── board/
    │   ├── board_init.cpp       # GPIO 15 power gate, button config
    │   └── battery.cpp          # ADC channel 3 voltage telemetry
    ├── display/
    │   ├── display_driver.cpp   # ST7789 parallel bus initialization
    │   └── ui_renderer.cpp      # Layout rendering and status cards
    ├── network/
    │   ├── wifi_manager.cpp     # AP + STA connection management
    │   └── rest_server.cpp      # WebServer route definitions
    ├── protocol/
    │   ├── serial_parser.cpp    # CLI command interpreter
    │   └── telemetry_packet.cpp # Atomic JSON serializer
    ├── actuator/
    │   ├── servo_driver.cpp     # Lazy attachment & active line clamping
    │   └── motion_engine.cpp    # Non-blocking cycle state machine
    └── config/
        └── nvs_storage.cpp      # Non-volatile Preferences persistence
```

---

## 4. Proposed System-Level Lifecycle & Failure States (`PROPOSED`)

```
   [ POWER ON / RESET ]
           |
           v
       +-------+
       | BOOT  | ---> (Fail) ---> [ BOOT_FAILURE ] (Halt with LED blink)
       +-------+
           | (Pass)
           v
    +-------------+
    |  SELF_TEST  | ---> (Fail) ---> [ HARDWARE_FAILURE ] (LCD error display)
    +-------------+
           | (Pass)
           v
  +--------------------+
  | NETWORK_CONNECTING | ---> (Fail) ---> (Fallback to standalone AP)
  +--------------------+
           | (Ready)
           v
       +-------+
  +--->| READY |<------------------------------------------+
  |    +-------+                                           |
  |        |                                               |
  |        v (Command Received)                            |
  |  +--------------------+                                |
  |  | COMMAND_PROCESSING | ---> (Parse Error) ---> [ PROTOCOL_FAILURE ]
  |  +--------------------+                                |
  |        | (Valid)                                       |
  |        v                                               |
  |  +-----------+                                         |
  |  | EXECUTING | ---> (Watchdog Timeout) ---> [ WATCHDOG_RECOVERY ]
  |  +-----------+                                         |
  |        | (Step Done)                                   |
  |        v                                               |
  |  +-----------+                                         |
  |  | REPORTING |-----------------------------------------+
  |  +-----------+
```
