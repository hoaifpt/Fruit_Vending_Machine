#include "core/runtime_api.hpp"

// 11B. IR SENSOR & BOWL DETECTION ENGINE
// ============================================================

void setupIrSensor() {
    pinMode(IR_RECEIVER_PIN, INPUT_PULLUP);
    pinMode(IR_TRANSMITTER_PIN, OUTPUT);
    digitalWrite(IR_TRANSMITTER_PIN, irTxEnabled ? HIGH : LOW);
    irRawValue = digitalRead(IR_RECEIVER_PIN);
    irDetected = (irActiveLow ? (irRawValue == LOW) : (irRawValue == HIGH));
    irStableReading = irDetected;
    irLastStateChangeMs = millis();
    Serial.println("[IR] Sensor initialized on GPIO 10 (Rx) & GPIO 11 (Tx)");
}

void updateIrSensor() {
    int raw = digitalRead(IR_RECEIVER_PIN);
    irRawValue = raw;
    bool currentReading = (irActiveLow ? (raw == LOW) : (raw == HIGH));
    unsigned long now = millis();

    if (currentReading != irStableReading) {
        if (now - irLastStateChangeMs >= irDebounceMs) {
            irStableReading = currentReading;
            irLastStateChangeMs = now;

            if (irStableReading && !irDetected) {
                // RISING EDGE: Bowl broke the beam
                irDetected = true;
                irObjectCount++;
                irLastDetectionMs = now;
                irBlockStartMs = now;
                irBlockDurationMs = 0;

                Serial.printf("[IR] BOWL DETECTED! Count = %u (GPIO 10)\n", irObjectCount);

                // Auto-trigger actions if configured
                if (irAutoTriggerServo == 1) {
                    if (!motionIsRunning(motionState1)) startOpen1();
                } else if (irAutoTriggerServo == 2) {
                    if (!motionIsRunning(motionState2)) startOpen2();
                } else if (irAutoTriggerServo == 3) {
                    openAll();
                } else if (irAutoTriggerServo == 4) {
                    startDispenseCol1();
                } else if (irAutoTriggerServo == 5) {
                    startDispenseCol2();
                }

                updateLcdQuad();
            } else if (!irStableReading && irDetected) {
                // FALLING EDGE: Bowl has passed through
                irDetected = false;
                irBlockDurationMs = now - irBlockStartMs;
                Serial.printf("[IR] BEAM CLEAR! Bowl passed through in %lu ms\n", irBlockDurationMs);
                updateLcdQuad();
            }
        }
    } else {
        irLastStateChangeMs = now;
        if (irDetected) {
            irBlockDurationMs = now - irBlockStartMs;
            if (!irStableReading && (now - irLastDetectionMs > 600)) {
                irDetected = false;
                Serial.printf("[IR] BEAM CLEAR! Bowl passed through in %lu ms\n", irBlockDurationMs);
                updateLcdQuad();
            }
        }
    }
}

// ============================================================
