
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

#ifndef APP_MQTT_USERNAME
#define APP_MQTT_USERNAME ""
#endif

#ifndef APP_MQTT_PASSWORD
#define APP_MQTT_PASSWORD ""
#endif

namespace AppConfig
{
    constexpr unsigned long SERVO_MOVE_TIME_MS = 300;
    constexpr unsigned long SENSOR_DEBOUNCE_MS = 30;
    constexpr uint8_t SENSOR_ACTIVE_LEVEL = LOW;
    constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
    constexpr unsigned long MQTT_RETRY_INTERVAL_MS = 5000;

    constexpr int SERVO_STOP_US = 1500;
    constexpr int SERVO_OPEN_US = 2000;
    constexpr int SERVO_CLOSE_US = 1000;

    constexpr char WIFI_SSID[] = APP_WIFI_SSID;
    constexpr char WIFI_PASSWORD[] = APP_WIFI_PASSWORD;
    constexpr char MQTT_HOST[] = APP_MQTT_HOST;
    constexpr uint16_t MQTT_PORT = APP_MQTT_PORT;
    constexpr char MQTT_USERNAME[] = APP_MQTT_USERNAME;
    constexpr char MQTT_PASSWORD[] = APP_MQTT_PASSWORD;
    constexpr char MACHINE_ID[] = "machine001";
}
