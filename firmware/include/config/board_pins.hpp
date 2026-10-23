#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ESP32Servo.h>
#include <Arduino_GFX_Library.h>

// ============================================================
// ESP32 CONTROL CENTER - QUAD SERVO (4 SERVOS AUTO & FIFO)
// Board: LILYGO T-Display-S3 (ESP32-S3R8, 16MB Flash, 8MB PSRAM) / ESP32 DevKit
// Servo 1: GPIO 1  (Col 1 Lower Gate) [or GPIO 18 on standard ESP32]
// Servo 2: GPIO 2  (Col 1 Upper Gate) [or GPIO 19 on standard ESP32]
// Servo 3: GPIO 12 (Col 2 Lower Gate) [or GPIO 21 on standard ESP32]
// Servo 4: GPIO 13 (Col 2 Upper Gate) [or GPIO 22 on standard ESP32]
// Both with Lazy PWM Attach & Zero-Drift Active Ground Clamping
// Supports FIFO Dual-Column Vending Machine Dispense Sequence
// ============================================================

// -----------------------------
// 1. PIN CONFIGURATION
// Cột 1: Dưới GPIO 18, Trên GPIO 19
// Cột 2: Dưới GPIO 21, Trên GPIO 22
// -----------------------------
#define BOARD_SERVO_1_PIN         18  // Cột 1 Cửa Dưới (Nhả tô Cột 1)
#define BOARD_SERVO_2_PIN         19  // Cột 1 Cửa Trên (Nạp/Giữ tô Cột 1)
#define BOARD_SERVO_3_PIN         21  // Cột 2 Cửa Dưới (Nhả tô Cột 2)
#define BOARD_SERVO_4_PIN         22  // Cột 2 Cửa Trên (Nạp/Giữ tô Cột 2)
#define BOARD_IR_RECEIVER_PIN     25  // Safe Digital Input (IR Receiver / Beam Sensor)
#define BOARD_IR_TRANSMITTER_PIN  26  // Safe Digital Output (IR Transmitter LED)

#if defined(CONFIG_IDF_TARGET_ESP32S3)
#define HAS_ST7789_PARALLEL_LCD   1
#else
#define HAS_ST7789_PARALLEL_LCD   0
#endif

#ifndef SERVO_1_PIN
#define SERVO_1_PIN BOARD_SERVO_1_PIN
#endif
#ifndef SERVO_2_PIN
#define SERVO_2_PIN BOARD_SERVO_2_PIN
#endif
#ifndef SERVO_3_PIN
#define SERVO_3_PIN BOARD_SERVO_3_PIN
#endif
#ifndef SERVO_4_PIN
#define SERVO_4_PIN BOARD_SERVO_4_PIN
#endif

#define SERVO_PIN           SERVO_1_PIN // Backwards compatibility
#ifndef IR_RECEIVER_PIN
#define IR_RECEIVER_PIN     BOARD_IR_RECEIVER_PIN
#endif
#ifndef IR_TRANSMITTER_PIN
#define IR_TRANSMITTER_PIN  BOARD_IR_TRANSMITTER_PIN
#endif

#define LCD_POWER_PIN       15
#define LCD_BL_PIN          38

