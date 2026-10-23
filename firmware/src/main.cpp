#include "core/runtime_api.hpp"

// 19. MAIN SETUP & LOOP
// ============================================================

void setup() {
    Serial.begin(115200);
    Serial.setTimeout(50);
    delay(500);

    Serial.println();
    Serial.println("================================================");
    Serial.println("ESP32 QUAD SERVO & IR BOWL DETECTOR (4 SERVOS)");
    Serial.println("LILYGO T-Display-S3 / ESP32 DevKit");
    Serial.printf("SERVO 1 (Col 1 Lower): GPIO %d\n", SERVO_1_PIN);
    Serial.printf("SERVO 2 (Col 1 Upper): GPIO %d\n", SERVO_2_PIN);
    Serial.printf("SERVO 3 (Col 2 Lower): GPIO %d\n", SERVO_3_PIN);
    Serial.printf("SERVO 4 (Col 2 Upper): GPIO %d\n", SERVO_4_PIN);
    Serial.printf("IR RX: GPIO %d  | IR TX: GPIO %d\n", IR_RECEIVER_PIN, IR_TRANSMITTER_PIN);
    Serial.println("================================================");

#if HAS_ST7789_PARALLEL_LCD
    // 1. Energize display power and backlight (LILYGO T-Display-S3 only)
    pinMode(LCD_POWER_PIN, OUTPUT);
    digitalWrite(LCD_POWER_PIN, HIGH);
    delay(10);

    pinMode(LCD_BL_PIN, OUTPUT);
    digitalWrite(LCD_BL_PIN, HIGH);

    if (gfx) {
        gfx->begin();
        gfx->fillScreen(COLOR_BLACK);
        lcdShow("QUAD SERVO S3", "Khoi dong 4 Servo...");
    }
#endif

    // 2. Allocate LEDC timers (4 hardware timers for 4 servos)
    ESP32PWM::allocateTimer(0);
    ESP32PWM::allocateTimer(1);
    ESP32PWM::allocateTimer(2);
    ESP32PWM::allocateTimer(3);

    // 3. Load config and clamp all 4 servo pins firmly to LOW (zero drift)
    loadConfig();
    servo1StopNow();
    servo2StopNow();
    servo3StopNow();
    servo4StopNow();

    // 3B. Initialize IR Sensor (Receiver & Transmitter)
    setupIrSensor();

    // 4. Start network & server
    setupWiFi();
    setupWebServer();

    updateLcdQuad();
    Serial.println("[SYSTEM] READY - 4 Servo Channels Armed & Ground-Clamped.");
}

void loop() {
    server.handleClient();
    updateMotion();
    updateIrSensor();
    handleSerial();
    delay(2);
}
