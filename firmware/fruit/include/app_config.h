
#pragma once

#include <Arduino.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef APP_WIFI_SSID
#define APP_WIFI_SSID ""
#endif

#ifndef APP_WIFI_PASSWORD
#define APP_WIFI_PASSWORD ""
#endif

#ifndef APP_MQTT_HOST
#define APP_MQTT_HOST ""
#endif

#ifndef APP_MQTT_PORT
#define APP_MQTT_PORT 1883
#endif

// Machine code registered in the backend (uppercase). It is also the MQTT username and client id (api-contract/mqtt-contract.md).
#ifndef APP_MACHINE_CODE
#define APP_MACHINE_CODE "FV-DEV-001"
#endif

#ifndef APP_MQTT_PASSWORD
#define APP_MQTT_PASSWORD ""
#endif

namespace AppConfig
{
    constexpr char FIRMWARE_VERSION[] = "0.3.0";

    // Continuous-rotation servos: a gate opens by turning for SERVO_OPEN_TIME_MS and closes by turning back for
    // SERVO_CLOSE_TIME_MS, then stops. Closing runs a little longer so the gate always ends fully shut.
    // Calibrate these on the real mechanism (Serial command: SERVO <n> <pulseUs> <ms>).
    constexpr unsigned long SERVO_OPEN_TIME_MS = 600;   // calibrated on the real gates (2026-10-23): 2000 us for 600 ms opens
    constexpr unsigned long SERVO_CLOSE_TIME_MS = 700;  // 1000 us for 700 ms closes
    constexpr unsigned long LOCK_UPPER_TIME_MS = 250;   // ensure upper gate is locked tight before opening lower gate
    constexpr int SERVO_STOP_US = 1500;
    constexpr int SERVO_OPEN_US = 2000;
    constexpr int SERVO_CLOSE_US = 1000;
    constexpr int SERVO_MIN_US = 1000;
    constexpr int SERVO_MAX_US = 2000;
    constexpr unsigned long SERVO_TEST_MAX_MS = 15000;

    // Gates, as a bit mask of servo numbers (bit 0 = servo 1 on GPIO 18, bit 1 = servo 2 on GPIO 19, bit 2 = servo 3 on GPIO 21, bit 3 = servo 4 on GPIO 22).
    // Column 1: Servo 1 = lower gate, Servo 2 = upper gate
    constexpr uint8_t LOWER_GATE_COL1 = 0b0001;
    constexpr uint8_t UPPER_GATE_COL1 = 0b0010;

    // Column 2: Servo 3 = lower gate, Servo 4 = upper gate
    constexpr uint8_t LOWER_GATE_COL2 = 0b0100;
    constexpr uint8_t UPPER_GATE_COL2 = 0b1000;

    // Legacy default mappings
    constexpr uint8_t LOWER_GATE_SERVOS = LOWER_GATE_COL1;
    constexpr uint8_t UPPER_GATE_SERVOS = UPPER_GATE_COL1;

    // Dispense cycle (FIFO 2-gate mechanism):
    // 1. Lock upper -> 2. Lower opens -> 3. Bowl falls -> 4. Lower closes ->
    // 5. PAUSE ~5s between mechanisms ->
    // 6. Upper opens -> 7. Next bowl falls into position -> 8. Upper closes.
    constexpr unsigned long DISPENSE_HOLD_MS = 700;           // lower gate kept open while the bowl falls out
    constexpr unsigned long GATE_TRANSITION_PAUSE_MS = 3000;  // 3 seconds delay between the 2 mechanisms
    constexpr unsigned long REFILL_HOLD_MS = 700;             // upper gate kept open while next bowl falls into position

    constexpr unsigned long SENSOR_DEBOUNCE_MS = 30;
    constexpr uint8_t SENSOR_ACTIVE_LEVEL = LOW;

    constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 20000;
    constexpr unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
    constexpr uint16_t MQTT_BUFFER_SIZE = 1024;
    constexpr uint16_t MQTT_KEEP_ALIVE_SECONDS = 30;
    constexpr char MQTT_TOPIC_ROOT[] = "vending";

    constexpr unsigned long SERIAL_BAUD = 115200;

    constexpr char WIFI_SSID[] = APP_WIFI_SSID;
    constexpr char WIFI_PASSWORD[] = APP_WIFI_PASSWORD;
    constexpr char MQTT_HOST[] = APP_MQTT_HOST;
    constexpr uint16_t MQTT_PORT = APP_MQTT_PORT;
    constexpr char MACHINE_CODE[] = APP_MACHINE_CODE;
    constexpr char MQTT_PASSWORD[] = APP_MQTT_PASSWORD;
}
