
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
    constexpr int SERVO_STOP_US = 1500;
    constexpr int SERVO_OPEN_US = 2000;
    constexpr int SERVO_CLOSE_US = 1000;
    constexpr int SERVO_MIN_US = 1000;
    constexpr int SERVO_MAX_US = 2000;
    constexpr unsigned long SERVO_TEST_MAX_MS = 15000;

    // Gates, as a bit mask of servo numbers (bit 0 = servo 1 on GPIO 18, bit 1 = servo 2 on GPIO 19, bit 2 = servo 3, bit 3 = servo 4).
    // LOWER gate holds the bowl in dispensing position; UPPER gate holds the rest of the column. Change to match the wiring.
    constexpr uint8_t LOWER_GATE_SERVOS = 0b0001;
    constexpr uint8_t UPPER_GATE_SERVOS = 0b0010;

    // Dispense cycle (never both gates open): lower opens -> bowl falls out -> lower closes ->
    // upper opens -> next bowl falls into position -> upper closes.
    constexpr unsigned long DISPENSE_HOLD_MS = 700;      // lower gate kept open while the bowl falls out
    constexpr unsigned long REFILL_HOLD_MS = 700;        // upper gate kept open while the next bowl falls into position

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
