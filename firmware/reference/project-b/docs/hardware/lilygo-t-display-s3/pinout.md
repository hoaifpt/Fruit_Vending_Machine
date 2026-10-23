# LILYGO T-Display-S3 Authoritative Pinout & GPIO Reference

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. Master Pinout Table

The ESP32-S3 provides 45 physical GPIO lines. On the **LILYGO T-Display-S3**, these pins are strictly allocated between the dedicated high-speed parallel display, peripheral power management, onboard buttons, native USB, battery telemetry, and external expansion headers.

> [!CAUTION]
> Do NOT connect external sensors or actuators to any pin marked **`NO`** in the "Can External Hardware Use It?" column. Doing so will freeze the display, corrupt flash memory, or cause hardware reset loops.

| GPIO | Primary Function | Direction | Connected Subsystem | Electrical Considerations | Can External Use? | Technical Notes |
|:---:|---|:---:|---|---|:---:|---|
| **0** | `BOOT` / Button 1 | In | Onboard Tactile Button (Bootloader) | 10kΩ Pull-Up to 3.3V; Pulled to GND when pressed | **RESTRICTED** | Strapping pin (LOW on reset enters ROM Download mode). Safe to read after boot if debounced. |
| **1** | Actuator / ADC1_CH0 | Out/In | **Primary Servo Control Pin** | 3.3V CMOS Level, LEDC Timer PWM | **YES** | Breakout on Left Header Pin 2. Current project uses this for continuous rotation servo. |
| **2** | General GPIO / ADC1_CH1 | In/Out | Free Breakout Header | High impedance input, ADC1 channel 1 | **YES** | Breakout on Left Header Pin 3. Safe for external analog/digital sensors. |
| **3** | Strapping / ADC1_CH2 | In/Out | Free Breakout Header | Strapping pin for JTAG signal source | **RESTRICTED** | Must NOT be pulled high/low externally during boot reset. Safe for use post-boot. |
| **4** | Battery Voltage Monitor | In (ADC) | Onboard Voltage Divider | 100kΩ / 100kΩ divider from VBAT to GND | **NO** | Reads $V_{BAT} / 2$. Accurate only when USB-C is disconnected. Internal connection. |
| **5** | `LCD_RST` | Out | ST7789 Display Reset | Active LOW hardware reset pulse | **NO** | Reserved internally for LCD panel initialization. |
| **6** | `LCD_CS` | Out | ST7789 Chip Select | Active LOW bus selection line | **NO** | Reserved internally for parallel bus addressing. |
| **7** | `LCD_DC` | Out | ST7789 Data/Command | LOW = Command byte, HIGH = Data byte | **NO** | Reserved internally for parallel bus transaction framing. |
| **8** | `LCD_WR` | Out | ST7789 Write Strobe | Rising-edge data latch clock | **NO** | Reserved internally for parallel bus 8-bit latching. |
| **9** | `LCD_RD` | Out | ST7789 Read Strobe | Active LOW data read enable | **NO** | Reserved internally; held HIGH during normal display writes. |
| **10** | FSPI_CS / ADC1_CH9 | In/Out | Free Breakout Header | General-purpose SPI2 bus Chip Select | **YES** | Left Header Pin 5. Ideal for external SPI SD card module. |
| **11** | FSPI_MOSI / ADC2_CH0 | In/Out | Free Breakout Header | General-purpose SPI2 bus Master Out | **YES** | Left Header Pin 6. Note: ADC2 unavailable when Wi-Fi is active. |
| **12** | FSPI_CLK / ADC2_CH1 | In/Out | Free Breakout Header | General-purpose SPI2 bus Serial Clock | **YES** | Left Header Pin 7. |
| **13** | FSPI_MISO / ADC2_CH2 | In/Out | Free Breakout Header | General-purpose SPI2 bus Master In | **YES** | Left Header Pin 8. |
| **14** | `KEY` / Button 2 | In | Onboard Tactile Button (User Key) | Internal Pull-Up, active LOW | **RESTRICTED** | Used for user input or deep-sleep wake up (`esp_sleep_enable_ext0_wakeup`). |
| **15** | `PIN_POWER_ON` | Out | **Peripheral & LCD Power Gate** | Active HIGH drive to power switch | **NO** | **CRITICAL:** MUST be set HIGH in `setup()` to energize LCD and peripherals on battery/header power. |
| **16** | Touch INT (Touch model) | In | CST816S Capacitive Touch | Open-drain interrupt with pull-up | **RESTRICTED** | Used by capacitive touch panel on Touch variant. Available if non-touch model. |
| **17** | `I2C_SCL` / Touch SCL | Out/OD | Onboard I2C Clock / Header | Requires external pull-up if used on header | **YES** | Shared with Touch variant. Default hardware I2C Clock pin. |
| **18** | `I2C_SDA` / Touch SDA | In/Out/OD| Onboard I2C Data / Header | Requires external pull-up if used on header | **YES** | Shared with Touch variant. Default hardware I2C Data pin. |
| **19** | `USB_D-` | Bi-dir | Native USB Type-C Connector | Controlled by internal USB-OTG PHY | **NO** | Dedicated to USB CDC serial communication and firmware flashing. |
| **20** | `USB_D+` | Bi-dir | Native USB Type-C Connector | Controlled by internal USB-OTG PHY | **NO** | Dedicated to USB CDC serial communication and firmware flashing. |
| **21** | Touch RST (Touch model)| Out | CST816S Touch Reset / Header | Active LOW hardware reset | **YES (Non-touch)**| Used by touch controller on Touch version; free on non-touch version. |
| **38** | `LCD_BL` | Out (PWM)| LCD Backlight LED Anode Driver | N-MOSFET gate drive, LEDC PWM capable | **NO** | Dedicated to display backlight illumination (GPIO 38 HIGH = 100% brightness). |
| **39** | `LCD_D0` | Out | ST7789 Parallel Data Bit 0 | Direct bus connection | **NO** | Reserved internally for display parallel frame buffer. |
| **40** | `LCD_D1` | Out | ST7789 Parallel Data Bit 1 | Direct bus connection | **NO** | Reserved internally for display parallel frame buffer. |
| **41** | `LCD_D2` | Out | ST7789 Parallel Data Bit 2 | Direct bus connection | **NO** | Reserved internally for display parallel frame buffer. |
| **42** | `LCD_D3` | Out | ST7789 Parallel Data Bit 3 | Direct bus connection | **NO** | Reserved internally for display parallel frame buffer. |
| **43** | `U0TXD` | Out | Hardware UART0 TX / Header | 3.3V UART Transmitter | **YES** | Available on Right Header for hardware serial logging or external UART modem. |
| **44** | `U0RXD` | In | Hardware UART0 RX / Header | 3.3V UART Receiver | **YES** | Available on Right Header for external serial CLI or GPS/sensor input. |
| **45** | `LCD_D4` | Out | ST7789 Parallel Data Bit 4 | Direct bus connection | **NO** | Reserved internally for display parallel frame buffer. |
| **46** | `LCD_D5` | Out | ST7789 Parallel Data Bit 5 | Direct bus connection | **NO** | Reserved internally for display parallel frame buffer. |
| **47** | `LCD_D6` | Out | ST7789 Parallel Data Bit 6 | Direct bus connection | **NO** | Reserved internally for display parallel frame buffer. |
| **48** | `LCD_D7` | Out | ST7789 Parallel Data Bit 7 | Direct bus connection | **NO** | Reserved internally for display parallel frame buffer. |

---

## 2. Expansion Header Physical Layout

The T-Display-S3 features two 12-pin single-row 2.54 mm headers (referred to as **P2 Left Header** and **P1 Right Header** with the USB-C port facing downward and the screen facing you):

### Left Header (P2)
```
          +-------------+
   Pin 1  | 3V3         | ---> 3.3V Regulated Output (Max ~400mA available)
   Pin 2  | GPIO 1      | ---> Actuator Control Line (Current: Servo PWM)
   Pin 3  | GPIO 2      | ---> Free GPIO / ADC1_CH1 / Touch1
   Pin 4  | GPIO 3      | ---> Free GPIO / Strapping Pin (Keep floating at boot)
   Pin 5  | GPIO 10     | ---> FSPI_CS / ADC1_CH9
   Pin 6  | GPIO 11     | ---> FSPI_MOSI / ADC2_CH0
   Pin 7  | GPIO 12     | ---> FSPI_CLK / ADC2_CH1
   Pin 8  | GPIO 13     | ---> FSPI_MISO / ADC2_CH2
   Pin 9  | GPIO 17     | ---> I2C SCL (Shared with Touch Controller)
   Pin 10 | GPIO 18     | ---> I2C SDA (Shared with Touch Controller)
   Pin 11 | GPIO 21     | ---> Free GPIO (Non-touch) / Touch Reset (Touch)
   Pin 12 | GND         | ---> System Ground
          +-------------+
```

### Right Header (P1)
```
          +-------------+
   Pin 1  | GND         | ---> System Ground
   Pin 2  | 5V          | ---> 5V VBUS Rail (USB Power Output)
   Pin 3  | GPIO 43     | ---> Hardware UART0 TX (U0TXD)
   Pin 4  | GPIO 44     | ---> Hardware UART0 RX (U0RXD)
   Pin 5  | N/C         | ---> Not Connected / Internal
   Pin 6  | N/C         | ---> Not Connected / Internal
   Pin 7  | N/C         | ---> Not Connected / Internal
   Pin 8  | N/C         | ---> Not Connected / Internal
   Pin 9  | N/C         | ---> Not Connected / Internal
   Pin 10 | N/C         | ---> Not Connected / Internal
   Pin 11 | 3V3         | ---> 3.3V Regulated Output
   Pin 12 | GND         | ---> System Ground
          +-------------+
```

---

## 3. Safe External Hardware Expansion Summary

When adding external modules (servos, relays, sensors, I2C devices):

1.  **For Digital Outputs / Actuators:**
    *   **Primary:** `GPIO 1` (P2 Pin 2) – verified stable for LEDC hardware PWM.
    *   **Secondary:** `GPIO 2` (P2 Pin 3) – general purpose, low risk.
2.  **For Analog Sensors (ADC):**
    *   Use **ADC1 pins only**: `GPIO 1`, `GPIO 2`, `GPIO 3`, `GPIO 10`.
    *   Avoid ADC2 pins (`GPIO 11`, `GPIO 12`, `GPIO 13`) if Wi-Fi is active, because the Wi-Fi driver takes exclusive ownership of the ADC2 SAR controller.
3.  **For I2C Busses (OLED, IMU, Environmental Sensors):**
    *   Use `GPIO 18` (SDA) and `GPIO 17` (SCL). Include 4.7kΩ pull-up resistors to 3.3V if your external breakout does not include them.
4.  **For SPI Devices (MicroSD Card Reader):**
    *   Use FSPI: CS=`GPIO 10`, MOSI=`GPIO 11`, CLK=`GPIO 12`, MISO=`GPIO 13`.
