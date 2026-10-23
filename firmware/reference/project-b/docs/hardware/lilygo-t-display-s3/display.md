# LILYGO T-Display-S3 Display Subsystem Technical Reference

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. Display Architecture

The **LILYGO T-Display-S3** features an integrated 1.90-inch IPS TFT LCD driven by the Sitronix **ST7789V** controller.

### The 8-Bit Parallel (Intel 8080) Bus
Unlike conventional microcontroller displays that use SPI (1-bit serial with 10–40 MHz clocks), the T-Display-S3 uses an **8-bit Parallel Intel 8080 (I80) bus**.

```
ESP32-S3 SoC                              ST7789V LCD Controller
+------------------------+                +-------------------------+
| GPIO 39 (D0)           |===============>| DB0 (Data Bit 0)        |
| GPIO 40 (D1)           |===============>| DB1 (Data Bit 1)        |
| GPIO 41 (D2)           |===============>| DB2 (Data Bit 2)        |
| GPIO 42 (D3)           |===============>| DB3 (Data Bit 3)        |
| GPIO 45 (D4)           |===============>| DB4 (Data Bit 4)        |
| GPIO 46 (D5)           |===============>| DB5 (Data Bit 5)        |
| GPIO 47 (D6)           |===============>| DB6 (Data Bit 6)        |
| GPIO 48 (D7)           |===============>| DB7 (Data Bit 7)        |
|                        |                |                         |
| GPIO 6 (CS)            |--------------->| /CS (Chip Select, Low)  |
| GPIO 7 (DC)            |--------------->| DC (0=Cmd, 1=Data)      |
| GPIO 8 (WR)            |--------------->| /WR (Write Clock Pulse) |
| GPIO 9 (RD)            |--------------->| /RD (Read Enable, High) |
| GPIO 5 (RST)           |--------------->| /RES (Hardware Reset)   |
|                        |                |                         |
| GPIO 38 (BL)           |-----[FET]----->| LEDA (Backlight Anode)  |
| GPIO 15 (PWR)          |----[SWITCH]--->| VDD / LCD Power Rail    |
+------------------------+                +-------------------------+
```

### Bandwidth Advantage
*   Standard SPI: 1 bit per clock edge $\rightarrow$ ~20–40 Mbps maximum.
*   8-bit Parallel: 8 bits per write pulse $\rightarrow$ at 20 MHz bus clock, theoretical transfer rate is **160 Mbps** (20 MB/s). This allows tearing-free 60 FPS full-screen refreshes and smooth UI animations.

---

## 2. Physical vs. Logical Resolution & The 35-Pixel Offset

### Hardware Silicon Reality
The Sitronix ST7789 controller silicon is built for displays up to **240 × 320 pixels**.  
However, the physical glass panel installed on the T-Display-S3 has an active matrix of **170 × 320 pixels**.

### The Centering Formula
The 170-pixel wide physical matrix is centered within the 240-pixel driver frame memory:
$$\text{Column Offset} = \frac{240 - 170}{2} = 35 \text{ pixels}$$

```
+-------------------------------------------------------+
| ST7789 Internal Driver SRAM (240 pixels wide)         |
|  [0..34]       [35 ........................... 204]   | [205..239]
|  Unmapped      ACTIVE PHYSICAL GLASS AREA (170 px)    | Unmapped
|  Padding       col_offset = 35                        | Padding
+-------------------------------------------------------+
```

If the display driver is initialized with offset `0` instead of `35`:
1.  35 columns of random snow/artifacts appear on one side of the screen.
2.  The rightmost 35 columns of UI content are clipped and invisible off-screen.

---

## 3. Verified Library Driver Implementations

### Option A: `Arduino_GFX_Library` (Current Project Standard)

Pinned version: **`moononournation/GFX Library for Arduino@1.4.9`**

```cpp
#include <Arduino.h>
#include <Arduino_GFX_Library.h>

#define LCD_POWER_PIN   15
#define LCD_BL_PIN      38

// 1. Define the 8-bit parallel bus
Arduino_DataBus *bus = new Arduino_ESP32PAR8Q(
    7,  // DC
    6,  // CS
    8,  // WR
    9,  // RD
    39, // D0
    40, // D1
    41, // D2
    42, // D3
    45, // D4
    46, // D5
    47, // D6
    48  // D7
);

// 2. Instantiate ST7789 with exact 170x320 geometry and 35px offsets
Arduino_GFX *gfx = new Arduino_ST7789(
    bus,
    5,              // RST pin
    0,              // Default rotation: 0 (Portrait)
    true,           // IPS panel: true (enables color inversion)
    170,            // Physical Width
    320,            // Physical Height
    35, 0, 35, 0    // col_offset1, row_offset1, col_offset2, row_offset2
);

void setupDisplay() {
    // CRITICAL: Power on display hardware first
    pinMode(LCD_POWER_PIN, OUTPUT);
    digitalWrite(LCD_POWER_PIN, HIGH);
    delay(10);

    // Enable backlight
    pinMode(LCD_BL_PIN, OUTPUT);
    digitalWrite(LCD_BL_PIN, HIGH);

    // Initialize display driver
    gfx->begin();
    gfx->fillScreen(0x0000); // Clear to Black
}
```

### Option B: `TFT_eSPI` (Alternative Driver)

If migrating to `TFT_eSPI`, use the pre-built setup file in `User_Setup_Select.h`:
```cpp
#include <User_Setups/Setup206_LilyGo_T_Display_S3.h>
```
Which defines:
```cpp
#define TFT_PARALLEL_8_BIT
#define ST7789_DRIVER
#define TFT_WIDTH  170
#define TFT_HEIGHT 320
#define TFT_CS   6
#define TFT_DC   7
#define TFT_RST  5
#define TFT_WR   8
#define TFT_RD   9
#define TFT_D0   39
#define TFT_D1   40
#define TFT_D2   41
#define TFT_D3   42
#define TFT_D4   45
#define TFT_D5   46
#define TFT_D6   47
#define TFT_D7   48
#define TFT_BL   38
```

---

## 4. Screen Orientation Matrix

When calling `gfx->setRotation(rotation)`:

| Rotation Value | Coordinate Space ($W \times H$) | Physical Orientation | Visual Reference |
|:---:|:---:|:---:|---|
| **0** | $170 \times 320$ | Portrait | USB-C connector on bottom |
| **1** | $320 \times 170$ | Landscape | USB-C connector on right |
| **2** | $170 \times 320$ | Inverted Portrait | USB-C connector on top |
| **3** | $320 \times 170$ | Inverted Landscape | USB-C connector on left |

Current firmware uses **Rotation 1 (Landscape, 320×170)** for dashboard rendering.

---

## 5. Backlight PWM Dimming (LEDC)

The backlight pin (`GPIO 38`) is connected to the gate of an onboard N-channel MOSFET.  
It supports linear brightness dimming using the ESP32-S3 LEDC hardware timer:

```cpp
#define LCD_BL_PIN 38
#define LEDC_BL_CH 4
#define LEDC_BL_FREQ 5000
#define LEDC_BL_RES 8 // 8-bit resolution: 0 - 255

void initBacklight() {
    ledcSetup(LEDC_BL_CH, LEDC_BL_FREQ, LEDC_BL_RES);
    ledcAttachPin(LCD_BL_PIN, LEDC_BL_CH);
    setBrightness(200); // ~80% brightness
}

void setBrightness(uint8_t brightness) {
    ledcWrite(LEDC_BL_CH, brightness);
}
```

---

## 6. Common Display Failure Modes & Mitigations

| Symptom | Root Cause | Verified Fix |
|---|---|---|
| **Completely black screen, no light** | Backlight (`GPIO 38`) or Power Gate (`GPIO 15`) not energized. | Set both pins `OUTPUT` and `HIGH` prior to `gfx->begin()`. |
| **Backlight turns on, but screen is blank/grey** | Data bus bus contention or reset pulse omitted. | Ensure `pinMode(5, OUTPUT)` pulses LOW for 10ms, then HIGH for 10ms. |
| **Colours inverted (Red looks Cyan, White looks Black)** | IPS panel color inversion register disabled. | Pass `true` as the 4th parameter (`IPS = true`) in `Arduino_ST7789` constructor. |
| **35-pixel noisy stripe on side of screen** | Missing column offset in constructor. | Specify `col_offset = 35` in constructor (`35, 0, 35, 0`). |
| **`fatal error: esp32-hal-periman.h` during build** | `Arduino_GFX_Library` version $\ge 1.5.0$ installed. | Pin library to `moononournation/GFX Library for Arduino@1.4.9` in `platformio.ini`. |
