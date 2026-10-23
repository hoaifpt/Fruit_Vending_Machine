# LILYGO T-Display-S3 USB, Flashing & Debugging Reference

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. USB Subsystem Architecture

The **LILYGO T-Display-S3** does not use an external USB-to-UART bridge chip (such as the CP2102, CH340, or FTDI). Instead, the USB Type-C connector is wired directly to the internal **USB-Serial/JTAG Controller** and **USB OTG 1.1 PHY** inside the ESP32-S3 silicon.

```
USB Type-C Connector                   ESP32-S3 Internal Peripherals
+--------------------+                 +-----------------------------+
| Pin A6/B6 (D+)     |================>| GPIO 20 (USB_D+)            |
|                    |                 |                             |
| Pin A7/B7 (D-)     |================>| GPIO 19 (USB_D-)            |
|                    |                 |                             |
| Pin A4/B4/A9/B9    |---------------->| VBUS (+5V Input / Charger)  |
| Pin A1/B1/A12/B12  |---------------->| GND (Common Ground)         |
+--------------------+                 |                             |
                                       | Hardware USB Serial/JTAG    |
                                       | CDC Engine (VID:PID 303A:1001)
                                       +-----------------------------+
```

### Hardware USB Identifiers
*   **USB Vendor ID (VID):** `0x303A` (Espressif Systems)
*   **USB Product ID (PID):** `0x1001` (ESP32-S3 USB-Serial/JTAG CDC mode)
*   **Windows Device Manager Name:** `USB JTAG/serial debug unit (COMx)` or `USB-Serial/JTAG Device`

---

## 2. PlatformIO Build Flags for Native USB

Because the USB CDC engine is inside the ESP32-S3 firmware runtime, the Arduino Core must be instructed to map standard `Serial` output to the internal USB CDC endpoint:

```ini
build_flags =
    -D ARDUINO_USB_CDC_ON_BOOT=1   ; Directs Serial.print() to USB-C port
    -D ARDUINO_USB_MODE=1          ; Enables hardware USB-Serial/JTAG mode
```

> [!WARNING]
> If `-D ARDUINO_USB_CDC_ON_BOOT=1` is missing from `platformio.ini`:
> *   `Serial.println()` will send text to the hardware UART0 pins (`GPIO 43/44`).
> *   Your computer will see a valid COM port, but the Serial Monitor will remain completely empty!

---

## 3. Flash Upload & ROM Bootloader Modes

### 3.1 Automatic DTR/RTS Upload (Standard Workflow)
Under normal circumstances, `esptool.py` (invoked via `pio run -t upload`) sends DTR/RTS state toggles over the virtual COM port. The onboard auto-reset circuit pulls `GPIO 0` LOW while pulsing `EN / RST`, smoothly placing the chip into ROM Download Mode without physical user intervention.

### 3.2 Manual Bootloader Download Mode (Recovery Procedure)
If the user uploads firmware that crashes immediately on boot, enters deep sleep, or corrupts the USB CDC stack, the automatic DTR/RTS reset will fail.

Follow this exact physical sequence to force ROM Download Mode:

```
Step 1: Press and HOLD the physical "BOOT" button (GPIO 0).
Step 2: While holding BOOT, press and release the physical "RST" button once.
Step 3: Keep holding the "BOOT" button for 1.5 seconds.
Step 4: Release the "BOOT" button.
```

**Verification:** In Windows Device Manager, the COM port will refresh. The chip is now running its internal ROM bootloader, completely isolated from any faulty user flash code, and is ready to accept a fresh upload.

---

## 4. Upload Baud Rate & Connection Stability

> [!IMPORTANT]
> **VERIFIED EMPIRICAL FINDING:**  
> While some USB-UART chips accept 460,800 or 921,600 baud, native ESP32-S3 CDC endpoints on Windows host controllers frequently encounter packet framing drops at high speeds:
> ```
> A fatal error occurred: The device does not recognize the command.
> ```
> To guarantee 100% upload reliability, the project pins:
> ```ini
> upload_speed = 115200
> monitor_speed = 115200
> ```

---

## 5. Serial Communication Best Practices

When building HIL or host software (such as `server.py` or automated test scripts):

1.  **Fast Turnaround Timeout:**
    Set `Serial.setTimeout(50)` in `setup()` to eliminate blocking delays on incomplete lines.
2.  **Packet Fragmentation Guard:**
    Avoid streaming partial strings across multiple `Serial.print()` calls. Construct the complete response line in a local buffer or `String` and send it atomically using a single `Serial.println()`:
    ```cpp
    // RECOMMENDED: Single atomic transmission
    String packet = "[RES] {\"ok\":true,\"state\":\"" + motionStateStr() + "\"}";
    Serial.println(packet);
    ```
3.  **DTR/RTS Reset on Serial Open:**
    When Python opens the COM port with `pyserial`:
    ```python
    ser = serial.Serial("COM3", 115200, dsrdtr=False, rtscts=False)
    ser.setDTR(False)
    ser.setRTS(False)
    ```
    Asserting DTR=True can reboot the board unexpectedly during runtime monitoring.
