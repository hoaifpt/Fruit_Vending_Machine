# LILYGO T-Display-S3 Power Management & GPIO 15 Specification

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. The Critical Role of GPIO 15 (`PIN_POWER_ON`)

> [!CAUTION]
> **CRITICAL HARDWARE FACT (`VERIFIED`):**  
> On the LILYGO T-Display-S3, **GPIO 15** controls the hardware power gate switch that supplies voltage to the display subsystem and onboard peripherals.  
> If GPIO 15 is not explicitly driven **HIGH**, the LCD panel, backlight driver, and touch IC receive **zero power** when the board is operated from battery or an external power header.

### 1.1 Why GPIO 15 Exists
To achieve micro-ampere currents in battery-powered sleep modes, LilyGO hardware engineers inserted a high-side P-channel MOSFET load switch between the system power rail and the display/peripherals.

```
+3.3V Power Rail
     |
     +----[ S ]-- P-MOSFET Load Switch --[ D ]----> LCD VDD & Backlight Anode
                      |
                     [ G ]
                      |
                NPN Transistor / Inverter
                      |
                 10k Resistor
                      |
                 ESP32-S3 GPIO 15
```

*   When `GPIO 15 == LOW` (or floating at high-impedance after boot): The load switch is **OFF**. The display receives 0V.
*   When `GPIO 15 == HIGH`: The load switch conducts. Full 3.3V is delivered to the ST7789 panel, backlight boost circuit, and capacitive touch controller.

### 1.2 Peripherals Dependent on GPIO 15
1.  **ST7789V Display Logic:** $V_{DD}$ and $V_{DDI}$ power rails.
2.  **LCD Backlight Boost / Driver:** Anode power rail for LED backlight string.
3.  **CST816S Touch Controller (Touch Variant):** Logic power rail.

### 1.3 Mandatory Firmware Initialization
In every firmware targeting the T-Display-S3, the following two lines **must execute before any display driver calls**:

```cpp
void setup() {
    // 1. MUST BE FIRST: Energize display and peripheral power rail
    pinMode(15, OUTPUT);
    digitalWrite(15, HIGH);

    // 2. Allow rail voltage to stabilize (minimum 10ms)
    delay(10);

    // 3. Now initialize display backlight and bus
    pinMode(38, OUTPUT);
    digitalWrite(38, HIGH);
    
    // ... continue with display/system initialization
}
```

### 1.4 What Happens if GPIO 15 is Omitted?
*   **On USB-C Power:** In some board hardware revisions, parasitic leakage through the native USB VBUS bus can partially power the display logic, masking the bug during desktop development.
*   **On Battery Power (JST-GH):** The board boots, Wi-Fi starts, but the screen is **completely black and lifeless**. Developers often falsely conclude the display is broken or firmware has crashed.

---

## 2. Battery Subsystem & Charging Circuit

### 2.1 Battery Connector
*   **Physical Connector:** JST-GH 1.25 mm 2-pin polarized header on bottom of PCB.
*   **Battery Chemistry:** Single-cell Lithium Polymer (Li-Po) or Lithium Ion (Li-Ion).
*   **Nominal Voltage:** 3.7 V (Operating range: 3.2 V cutoff to 4.2 V full charge).
*   **Integrated Charge Controller:** Onboard linear charge management IC (typically TP4056 or SY6970/AXP compatible) configured for ~500 mA charging current from USB-C.

### 2.2 Battery Voltage Telemetry (ADC on GPIO 4)
The battery positive terminal ($V_{BAT}$) is connected to **GPIO 4** through a precision 1:2 resistor voltage divider ($100\text{ k}\Omega + 100\text{ k}\Omega$):

$$V_{GPIO4} = \frac{V_{BAT}}{2}$$

```
V_BAT (+3.7V - 4.2V)
      |
     [100k Ohm]
      |
      +--------> ESP32-S3 GPIO 4 (ADC1 Channel 3)
      |
     [100k Ohm]
      |
     GND
```

### 2.3 Verified Voltage Reading Code

```cpp
#include <Arduino.h>
#include <esp_adc_cal.h>

#define BATTERY_ADC_PIN 4

float readBatteryVoltage() {
    // Read calibrated millivolts directly from ESP-IDF ADC calibration
    uint32_t raw_mv = analogReadMilliVolts(BATTERY_ADC_PIN);
    
    // Multiply by 2 to compensate for the 1:2 voltage divider
    float vbat = (raw_mv * 2.0f) / 1000.0f;
    return vbat;
}

uint8_t calculateBatteryPercentage(float voltage) {
    if (voltage >= 4.20f) return 100;
    if (voltage <= 3.30f) return 0;
    // Linear approximation between 3.30V (0%) and 4.20V (100%)
    return (uint8_t)(((voltage - 3.30f) / (4.20f - 3.30f)) * 100.0f);
}
```

> [!NOTE]
> **Measurement Limitation:** When USB-C is plugged in, GPIO 4 measures the battery charger rail voltage (typically 4.20V–4.35V) rather than the battery's true resting cell voltage. True battery discharge monitoring is valid only when operating disconnected from USB.

---

## 3. Power Optimization & Deep Sleep Architecture

When implementing battery-conserving modes or standby states:

```cpp
void enterDeepSleep() {
    // 1. Turn off backlight PWM
    digitalWrite(38, LOW);
    
    // 2. Turn off display and peripheral power gate
    digitalWrite(15, LOW);
    
    // 3. Detach actuators and clamp control pins
    pinMode(1, OUTPUT);
    digitalWrite(1, LOW);
    
    // 4. Configure Button 2 (GPIO 14) as external wake-up source (Active LOW)
    esp_sleep_enable_ext0_wakeup(GPIO_NUM_14, 0);
    
    // 5. Enter ultra-low-power sleep (<25 uA total draw)
    esp_deep_sleep_start();
}
```
