#include "core/runtime_api.hpp"

// 9. SERVO LOW-LEVEL CONTROL (LAZY ATTACH & GROUND CLAMP)
// ============================================================

// --- SERVO 1 (GPIO 1 / GPIO 18) ---
void attachServo1IfNeeded() {
    if (servo1Attached) return;
    servo1.setPeriodHertz(50);
    servo1.attach(SERVO_1_PIN, 500, 2500);
    servo1Attached = true;
    delay(20);
}

void servo1StopNow() {
    if (servo1Attached) {
        servo1.write(servo1Stop);
        delay(20);
        servo1.detach();
        servo1Attached = false;
    }
    pinMode(SERVO_1_PIN, OUTPUT);
    digitalWrite(SERVO_1_PIN, LOW);
    Serial.println("[SERVO1] STOP -> PWM DETACHED, GPIO CLAMPED LOW");
}

void servo1ForwardNow() {
    attachServo1IfNeeded();
    servo1.write(servo1Forward);
    Serial.println("[SERVO1] FORWARD = " + String(servo1Forward));
}

void servo1ReverseNow() {
    attachServo1IfNeeded();
    servo1.write(servo1Reverse);
    Serial.println("[SERVO1] REVERSE = " + String(servo1Reverse));
}

void servo1TestStopValue(int value) {
    attachServo1IfNeeded();
    servo1.write(value);
    Serial.println("[CALIB1] STOP TEST = " + String(value));
}

// --- SERVO 2 (GPIO 2 / GPIO 19) ---
void attachServo2IfNeeded() {
    if (servo2Attached) return;
    servo2.setPeriodHertz(50);
    servo2.attach(SERVO_2_PIN, 500, 2500);
    servo2Attached = true;
    delay(20);
}

void servo2StopNow() {
    if (servo2Attached) {
        servo2.write(servo2Stop);
        delay(20);
        servo2.detach();
        servo2Attached = false;
    }
    pinMode(SERVO_2_PIN, OUTPUT);
    digitalWrite(SERVO_2_PIN, LOW);
    Serial.println("[SERVO2] STOP -> PWM DETACHED, GPIO CLAMPED LOW");
}

void servo2ForwardNow() {
    attachServo2IfNeeded();
    servo2.write(servo2Forward);
    Serial.println("[SERVO2] FORWARD = " + String(servo2Forward));
}

void servo2ReverseNow() {
    attachServo2IfNeeded();
    servo2.write(servo2Reverse);
    Serial.println("[SERVO2] REVERSE = " + String(servo2Reverse));
}

void servo2TestStopValue(int value) {
    attachServo2IfNeeded();
    servo2.write(value);
    Serial.println("[CALIB2] STOP TEST = " + String(value));
}

// --- SERVO 3 (GPIO 12 / GPIO 21) ---
void attachServo3IfNeeded() {
    if (servo3Attached) return;
    servo3.setPeriodHertz(50);
    servo3.attach(SERVO_3_PIN, 500, 2500);
    servo3Attached = true;
    delay(20);
}

void servo3StopNow() {
    if (servo3Attached) {
        servo3.write(servo3Stop);
        delay(20);
        servo3.detach();
        servo3Attached = false;
    }
    pinMode(SERVO_3_PIN, OUTPUT);
    digitalWrite(SERVO_3_PIN, LOW);
    Serial.println("[SERVO3] STOP -> PWM DETACHED, GPIO CLAMPED LOW");
}

void servo3ForwardNow() {
    attachServo3IfNeeded();
    servo3.write(servo3Forward);
    Serial.println("[SERVO3] FORWARD = " + String(servo3Forward));
}

void servo3ReverseNow() {
    attachServo3IfNeeded();
    servo3.write(servo3Reverse);
    Serial.println("[SERVO3] REVERSE = " + String(servo3Reverse));
}

void servo3TestStopValue(int value) {
    attachServo3IfNeeded();
    servo3.write(value);
    Serial.println("[CALIB3] STOP TEST = " + String(value));
}

// --- SERVO 4 (GPIO 13 / GPIO 22) ---
void attachServo4IfNeeded() {
    if (servo4Attached) return;
    servo4.setPeriodHertz(50);
    servo4.attach(SERVO_4_PIN, 500, 2500);
    servo4Attached = true;
    delay(20);
}

void servo4StopNow() {
    if (servo4Attached) {
        servo4.write(servo4Stop);
        delay(20);
        servo4.detach();
        servo4Attached = false;
    }
    pinMode(SERVO_4_PIN, OUTPUT);
    digitalWrite(SERVO_4_PIN, LOW);
    Serial.println("[SERVO4] STOP -> PWM DETACHED, GPIO CLAMPED LOW");
}

void servo4ForwardNow() {
    attachServo4IfNeeded();
    servo4.write(servo4Forward);
    Serial.println("[SERVO4] FORWARD = " + String(servo4Forward));
}

void servo4ReverseNow() {
    attachServo4IfNeeded();
    servo4.write(servo4Reverse);
    Serial.println("[SERVO4] REVERSE = " + String(servo4Reverse));
}

void servo4TestStopValue(int value) {
    attachServo4IfNeeded();
    servo4.write(value);
    Serial.println("[CALIB4] STOP TEST = " + String(value));
}

// Aliases for backwards compatibility
void attachServoIfNeeded() { attachServo1IfNeeded(); }
void servoStopNow() { servo1StopNow(); }
void servoForwardNow() { servo1ForwardNow(); }
void servoReverseNow() { servo1ReverseNow(); }
void servoTestStopValue(int val) { servo1TestStopValue(val); }

// ============================================================
