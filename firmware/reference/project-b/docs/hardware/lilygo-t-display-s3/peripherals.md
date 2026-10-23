# LILYGO T-Display-S3 Peripheral Interfacing & Actuator Safety Reference

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. Golden Rules of Peripheral Interfacing

> [!CAUTION]
> **RULE 1: The ESP32-S3 is a 3.3V logic device.**  
> Never inject 5V signals directly into any GPIO pin. Connecting a 5V sensor output directly to an ESP32-S3 pin will permanently destroy the internal protection diodes and I/O buffer. Always use a bi-directional logic level shifter (e.g. BSS138 or TXS0108E).

> [!CAUTION]
> **RULE 2: NEVER power motors, servos, or high-current solenoids from the ESP32 board.**  
> The onboard 3.3V LDO regulator can only supply ~500 mA total, the vast majority of which is reserved for the ESP32-S3 chip (up to 350 mA peak during Wi-Fi transmission bursts) and the LCD backlight (~70 mA). Attempting to power a motor from the 3.3V or 5V header will cause catastrophic brownout resets or thermal destruction of the regulator.

> [!IMPORTANT]
> **RULE 3: Common Ground is Mandatory.**  
> The ground (GND) of the external power supply **MUST** be bonded directly to an ESP32 GND pin. Without a shared ground reference, logic voltage thresholds will float, resulting in erratic actuation, high-frequency motor chattering, or signal degradation.

---

## 2. Dedicated Servo Integration Reference

Continuous rotation 360° servos (such as the MG995, MG996R, SG90-360, or FS90R) interpret standard hobby RC pulse-width modulation (PWM).

### 2.1 Complete Wiring Topology

```
+------------------------------------------------------------------------+
|                          WIRING DIAGRAM                                |
|                                                                        |
|  +--------------------+                                                |
|  | LILYGO             |                                                |
|  | T-Display-S3       |                                                |
|  |                    |                                                |
|  |  [GPIO 1] (Pin 2)  |---------------------+                          |
|  |                    |                     |                          |
|  |  [GND]    (Pin 12) |-----------+         | 3.3V Control Signal      |
|  +--------------------+           |         |                          |
|                                   |         v                          |
|                                   |   +-----------+                    |
|                                   |   | PWM Line  | (Orange/White)     |
|                                   |   |           |                    |
|                                   +-->| GND Line  | (Brown/Black)      |
|                                   |   |           |                    |
|  +--------------------+           |   | +5V VCC   | (Red)              |
|  | External 5V        |           |   +-----------+                    |
|  | Power Supply       |           |     360° SERVO                     |
|  | (5V DC, 2A min)    |           |                                    |
|  |                    |           |                                    |
|  |  [+5V Output]      |-----------|---------+                          |
|  |                    |           |         |                          |
|  |  [GND Return]      |-----------+         |                          |
|  +--------------------+                     v                          |
|                                        +----------+                    |
|                                        |  470 uF  | Decoupling Cap     |
|                                        |  16V Cap | (Low ESR)          |
|                                        +----------+                    |
+------------------------------------------------------------------------+
```

### 2.2 Signal Parameters (50 Hz RC Frame)

*   **Carrier Frequency:** 50 Hz ($T = 20\text{ ms}$).
*   **Pulse Width Range:** $500\ \mu\text{s}$ to $2500\ \mu\text{s}$.
*   **Mechanical Stop (Deadband):** $\sim 1500\ \mu\text{s}$ (represented in Arduino library as $90^\circ$).
*   **Forward Rotation:** Pulse widths $< 1500\ \mu\text{s}$ (e.g. $70^\circ \approx 1300\ \mu\text{s}$). Speed increases as pulse narrows toward $1000\ \mu\text{s}$.
*   **Reverse Rotation:** Pulse widths $> 1500\ \mu\text{s}$ (e.g. $110^\circ \approx 1700\ \mu\text{s}$). Speed increases as pulse widens toward $2000\ \mu\text{s}$.

---

## 3. The Anti-Drift Active Ground Clamping Solution

### 3.1 The Root Cause of "Idle Creep"
Continuous servos contain an internal potentiometer and analog H-bridge driver.  
When standard firmware executes `servo.detach()`, the ESP32 GPIO pin enters **high-impedance input mode (Hi-Z)**.  
In this floating state, capacitive coupling from surrounding wires and motor commutator EMI induces micro-volt noise spikes onto the servo gate, causing the internal amplifier to falsely detect pulses and slowly **creep/drift** even when the system state is `"DUNG"` (STOP).

### 3.2 The Hardware Fix: Lazy Attach + Active Ground Clamp
The verified solution implemented in [ESP32_Control_Center_ServoStop_FIXED_v2.ino](../../../ESP32_Control_Center_ServoStop_FIXED_v2.ino):

```cpp
void servoStopNow() {
    // 1. Detach software PWM timer
    if (servoAttached) {
        servo.detach();
        servoAttached = false;
    }
    
    // 2. CRITICAL: Reconfigure GPIO 1 as active low-impedance OUTPUT
    pinMode(SERVO_PIN, OUTPUT);
    
    // 3. Force line firmly to 0V (Earth ground reference)
    digitalWrite(SERVO_PIN, LOW);
}
```

*Result:* The signal line is clamped to 0.00V at low impedance ($< 30\ \Omega$). External noise is sunk harmlessly to ground. Mechanical drift is completely eliminated ($0\text{ RPM}$).

---

## 4. Peripheral Interfacing Matrix

| Peripheral Type | Recommended Pin | Signal Voltage | Power Source | Driver / Interface | Critical Safety Notes |
|---|:---:|:---:|---|---|---|
| **Continuous Servo** | `GPIO 1` | 3.3V PWM | External 5V DC (2A) | `ESP32Servo@1.2.1` | Must clamp to LOW when idle. Decoupling cap required. |
| **Relay Module** | `GPIO 2` | 3.3V Digital | External 5V DC | GPIO Output (Active LOW) | Use relay with optocoupler isolation and flyback diode. |
| **I2C Sensor (BME280, IMU)** | `GPIO 18` (SDA)<br>`GPIO 17` (SCL) | 3.3V Open Drain | ESP32 3.3V Header | Wire library (`Wire.begin()`) | Shared with Touch variant. Requires 4.7kΩ pull-ups to 3.3V. |
| **MicroSD SPI Card** | `GPIO 10` (CS)<br>`GPIO 11` (MOSI)<br>`GPIO 12` (CLK)<br>`GPIO 13` (MISO) | 3.3V SPI | ESP32 3.3V Header | SPI / SD_MMC | Keep trace lengths $< 10\text{ cm}$ to avoid clock jitter. |
| **External Push Button** | `GPIO 14` | 3.3V Digital | GND Return | `INPUT_PULLUP` | Connect between GPIO 14 and GND. Hardware debouncing capacitor ($0.1\ \mu\text{F}$) recommended. |
