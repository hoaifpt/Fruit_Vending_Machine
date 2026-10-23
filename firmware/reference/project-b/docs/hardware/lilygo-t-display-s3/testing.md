# LILYGO T-Display-S3 Hardware Verification & Testing Strategy

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. The Five Levels of Hardware Verification

An engineering agent (whether Codex or Antigravity) must never conflate compilation success with physical hardware compliance. The project defines five strict levels of verification:

```
[ LEVEL 1: Build Pass ]           --> Compiler generated ELF/BIN without error.
          |
          v
[ LEVEL 2: Static Code Pass ]      --> Headers valid, pins match board datasheet.
          |
          v
[ LEVEL 3: Unit / Mock Pass ]      --> Host-side parser/state tests executed.
          |
          v
[ LEVEL 4: Hardware Smoke Pass ]   --> Real silicon flashed on COM port, booted.
          |
          v
[ LEVEL 5: End-to-End Integration]--> Browser Web UI <-> Host Backend <-> Real ESP32.
```

> [!CAUTION]
> **CARDINAL RULE OF HARDWARE AGENTS:**  
> $$\text{BUILD PASS} \neq \text{UPLOAD PASS} \neq \text{SERIAL PASS} \neq \text{HARDWARE PASS} \neq \text{INTEGRATION PASS}$$  
> You must **NEVER** claim physical hardware verification unless real hardware was physically connected to a COM port, flashed, and empirically tested.

---

## 2. Standard Evidence Labels

Every test report, pull request, or verification summary must tag findings using these standardized labels:

| Label | Meaning | Required Evidence |
|---|---|---|
| `CODE_VERIFIED` | Code inspected against official hardware schematics. | Referenced datasheet section or official pin configuration file. |
| `BUILD_VERIFIED` | PlatformIO compiled and linked cleanly. | `pio run` returned exit code 0; Flash/RAM usage metrics captured. |
| `UPLOAD_VERIFIED`| Firmware flashed to physical silicon. | `esptool.py` verified hash of data at target flash addresses. |
| `SERIAL_VERIFIED`| Device booted and communicated over serial. | Serial boot log captured containing `[SYSTEM] READY`. |
| `HARDWARE_VERIFIED`| Actuators/sensors moved or responded as expected. | Timestamped telemetry trace demonstrating state transitions and clamp. |
| `INTEGRATION_VERIFIED`| Web UI, host backend, and ESP32 passed end-to-end. | Complete browser command triggers physical device motion and returns state. |

---

## 3. Automated HIL Test Suite Reference

The project includes an automated Hardware-in-the-Loop test harness in [scripts/hil_test_suite.py](../../../scripts/hil_test_suite.py).

### Execution Command
```bash
python scripts/hil_test_suite.py --port COM3 --baud 115200
```

### The 5 Verified HIL Verification Phases

#### Phase 5: Boot & Hardware Initialization Verification
*   **Target:** ESP-ROM bootloader handoff and subsystem power.
*   **Verification Criteria:**
    1. Reset chip via DTR/RTS pin toggle.
    2. Confirm ROM banner `esp32s3-20210327` emitted.
    3. ST7789 initialized without bus lockup.
    4. GPIO 15 and GPIO 38 driven HIGH.
    5. SoftAP initialized on `192.168.4.1`.
    6. System reaches `[SYSTEM] READY` state within 1.5 seconds.

#### Phase 6: REST API & Status Telemetry Verification
*   **Target:** Network command parser and JSON schema compliance.
*   **Verification Criteria:**
    1. Query `/api/status` $\rightarrow$ verify `HTTP 200 OK`, `ok: true`, valid `state`.
    2. Query `/api/config` $\rightarrow$ verify all timing and angle parameters present.

#### Phase 7: NVS Flash Configuration Persistence
*   **Target:** Non-volatile memory retention across power cycles.
*   **Verification Criteria:**
    1. Modify parameter: `CONFIG_SET forwardMs=1500`.
    2. Verify RAM updated immediately.
    3. Hard-reset the board via RTS toggle.
    4. Read back configuration from NVS partition $\rightarrow$ confirm `forwardMs == 1500`.
    5. Restore test baseline (`forwardMs = 1000`).

#### Phase 8: Servo Motion & Active Line Clamping
*   **Target:** Actuator state transitions, timing precision, and anti-drift clamping.
*   **Verification Criteria:**
    1. Send `START` $\rightarrow$ verify transition to `Đang quay thuận` (FWD = 110°).
    2. Measure duration $\rightarrow$ must match $1000\text{ ms} \pm 50\text{ ms}$.
    3. Verify transition to `Đang dừng` (PAUSE) $\rightarrow$ confirm PWM detached and line clamped LOW.
    4. Verify transition to `Đang quay nghịch` (REV = 70°).
    5. Verify cycle completion $\rightarrow$ state becomes `Hoàn thành` (`running: false`).
    6. Verify indefinite stationary state with 0 RPM creep.

#### Phase 9: Web Polling Read-Only Purity
*   **Target:** Side-effect-free status monitoring.
*   **Verification Criteria:**
    1. Send burst of 10 rapid queries within 1.0 second.
    2. Confirm state, cycle count, and PWM remain completely unchanged.

---

## 4. Antigravity Verification Workflow

When executing automated hardware validation:

```
Step 1: Inspect environment (Verify COM port presence via pyserial / list_ports).
Step 2: Build firmware (pio run -e lilygo-t-display-s3).
Step 3: Upload firmware (pio run -e lilygo-t-display-s3 -t upload -p COM3).
Step 4: Launch Serial Monitor and capture raw boot logs to docs/traces/boot_log.txt.
Step 5: Run HIL Test Suite (python scripts/hil_test_suite.py).
Step 6: Archive test traces and report results with exact evidence tags.
```

---

## 5. Codex Development Workflow

When writing new firmware or modifying board drivers:

```
Step 1: Read authoritative documentation in docs/hardware/lilygo-t-display-s3/.
Step 2: Inspect existing pin assignments before adding new peripherals.
Step 3: Implement minimal, non-blocking code changes.
Step 4: Compile locally (pio run) to guarantee zero compilation regressions.
Step 5: If a GPIO assignment is modified, update pinout.md and README.md immediately.
Step 6: Review diff to ensure no hardcoded credentials or blocking delays were introduced.
```
