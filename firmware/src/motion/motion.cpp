#include "core/runtime_api.hpp"

// 10. HIGH-LEVEL MOTION ACTIONS
// ============================================================

// --- SERVO 1 ACTIONS (Column 1 Lower Gate) ---
void startMotion1() {
    if (cycles1 < CYCLES_MIN) cycles1 = CYCLES_MIN;
    servo1StopNow();
    currentCycle1 = 1;
    motionState1 = STATE_FORWARD;
    state1StartedAt = millis();
    servo1ForwardNow();
    Serial.println("[MOTION1] START cycle=1/" + String(cycles1));
    updateLcdQuad();
}

void startOpen1() {
    servo1StopNow();
    currentCycle1 = 0;
    motionState1 = STATE_OPENING;
    state1StartedAt = millis();
    servo1ForwardNow();
    Serial.println("[MOTION1] START OPENING (Forward=" + String(servo1Forward) + ", time=" + String(forwardMs1) + "ms)");
    updateLcdQuad();
}

void startClose1() {
    servo1StopNow();
    currentCycle1 = 0;
    motionState1 = STATE_CLOSING;
    state1StartedAt = millis();
    servo1ReverseNow();
    Serial.println("[MOTION1] START CLOSING (Reverse=" + String(servo1Reverse) + ", time=" + String(reverseMs1) + "ms)");
    updateLcdQuad();
}

void stopMotion1() {
    servo1StopNow();
    motionState1 = STATE_IDLE;
    currentCycle1 = 0;
    state1StartedAt = millis();
    Serial.println("[MOTION1] STOP -> IDLE");
    updateLcdQuad();
}

void testForward1() {
    servo1StopNow();
    currentCycle1 = 0;
    motionState1 = STATE_MANUAL_FORWARD;
    state1StartedAt = millis();
    servo1ForwardNow();
    Serial.println("[MOTION1] TEST FWD");
    updateLcdQuad();
}

void testReverse1() {
    servo1StopNow();
    currentCycle1 = 0;
    motionState1 = STATE_MANUAL_REVERSE;
    state1StartedAt = millis();
    servo1ReverseNow();
    Serial.println("[MOTION1] TEST REV");
    updateLcdQuad();
}

// --- SERVO 2 ACTIONS (Column 1 Upper Gate) ---
void startMotion2() {
    if (cycles2 < CYCLES_MIN) cycles2 = CYCLES_MIN;
    servo2StopNow();
    currentCycle2 = 1;
    motionState2 = STATE_FORWARD;
    state2StartedAt = millis();
    servo2ForwardNow();
    Serial.println("[MOTION2] START cycle=1/" + String(cycles2));
    updateLcdQuad();
}

void startOpen2() {
    servo2StopNow();
    currentCycle2 = 0;
    motionState2 = STATE_OPENING;
    state2StartedAt = millis();
    servo2ForwardNow();
    Serial.println("[MOTION2] START OPENING (Forward=" + String(servo2Forward) + ", time=" + String(forwardMs2) + "ms)");
    updateLcdQuad();
}

void startClose2() {
    servo2StopNow();
    currentCycle2 = 0;
    motionState2 = STATE_CLOSING;
    state2StartedAt = millis();
    servo2ReverseNow();
    Serial.println("[MOTION2] START CLOSING (Reverse=" + String(servo2Reverse) + ", time=" + String(reverseMs2) + "ms)");
    updateLcdQuad();
}

void stopMotion2() {
    servo2StopNow();
    motionState2 = STATE_IDLE;
    currentCycle2 = 0;
    state2StartedAt = millis();
    Serial.println("[MOTION2] STOP -> IDLE");
    updateLcdQuad();
}

void testForward2() {
    servo2StopNow();
    currentCycle2 = 0;
    motionState2 = STATE_MANUAL_FORWARD;
    state2StartedAt = millis();
    servo2ForwardNow();
    Serial.println("[MOTION2] TEST FWD");
    updateLcdQuad();
}

void testReverse2() {
    servo2StopNow();
    currentCycle2 = 0;
    motionState2 = STATE_MANUAL_REVERSE;
    state2StartedAt = millis();
    servo2ReverseNow();
    Serial.println("[MOTION2] TEST REV");
    updateLcdQuad();
}

// --- SERVO 3 ACTIONS (Column 2 Lower Gate) ---
void startMotion3() {
    if (cycles3 < CYCLES_MIN) cycles3 = CYCLES_MIN;
    servo3StopNow();
    currentCycle3 = 1;
    motionState3 = STATE_FORWARD;
    state3StartedAt = millis();
    servo3ForwardNow();
    Serial.println("[MOTION3] START cycle=1/" + String(cycles3));
    updateLcdQuad();
}

void startOpen3() {
    servo3StopNow();
    currentCycle3 = 0;
    motionState3 = STATE_OPENING;
    state3StartedAt = millis();
    servo3ForwardNow();
    Serial.println("[MOTION3] START OPENING (Forward=" + String(servo3Forward) + ", time=" + String(forwardMs3) + "ms)");
    updateLcdQuad();
}

void startClose3() {
    servo3StopNow();
    currentCycle3 = 0;
    motionState3 = STATE_CLOSING;
    state3StartedAt = millis();
    servo3ReverseNow();
    Serial.println("[MOTION3] START CLOSING (Reverse=" + String(servo3Reverse) + ", time=" + String(reverseMs3) + "ms)");
    updateLcdQuad();
}

void stopMotion3() {
    servo3StopNow();
    motionState3 = STATE_IDLE;
    currentCycle3 = 0;
    state3StartedAt = millis();
    Serial.println("[MOTION3] STOP -> IDLE");
    updateLcdQuad();
}

void testForward3() {
    servo3StopNow();
    currentCycle3 = 0;
    motionState3 = STATE_MANUAL_FORWARD;
    state3StartedAt = millis();
    servo3ForwardNow();
    Serial.println("[MOTION3] TEST FWD");
    updateLcdQuad();
}

void testReverse3() {
    servo3StopNow();
    currentCycle3 = 0;
    motionState3 = STATE_MANUAL_REVERSE;
    state3StartedAt = millis();
    servo3ReverseNow();
    Serial.println("[MOTION3] TEST REV");
    updateLcdQuad();
}

// --- SERVO 4 ACTIONS (Column 2 Upper Gate) ---
void startMotion4() {
    if (cycles4 < CYCLES_MIN) cycles4 = CYCLES_MIN;
    servo4StopNow();
    currentCycle4 = 1;
    motionState4 = STATE_FORWARD;
    state4StartedAt = millis();
    servo4ForwardNow();
    Serial.println("[MOTION4] START cycle=1/" + String(cycles4));
    updateLcdQuad();
}

void startOpen4() {
    servo4StopNow();
    currentCycle4 = 0;
    motionState4 = STATE_OPENING;
    state4StartedAt = millis();
    servo4ForwardNow();
    Serial.println("[MOTION4] START OPENING (Forward=" + String(servo4Forward) + ", time=" + String(forwardMs4) + "ms)");
    updateLcdQuad();
}

void startClose4() {
    servo4StopNow();
    currentCycle4 = 0;
    motionState4 = STATE_CLOSING;
    state4StartedAt = millis();
    servo4ReverseNow();
    Serial.println("[MOTION4] START CLOSING (Reverse=" + String(servo4Reverse) + ", time=" + String(reverseMs4) + "ms)");
    updateLcdQuad();
}

void stopMotion4() {
    servo4StopNow();
    motionState4 = STATE_IDLE;
    currentCycle4 = 0;
    state4StartedAt = millis();
    Serial.println("[MOTION4] STOP -> IDLE");
    updateLcdQuad();
}

void testForward4() {
    servo4StopNow();
    currentCycle4 = 0;
    motionState4 = STATE_MANUAL_FORWARD;
    state4StartedAt = millis();
    servo4ForwardNow();
    Serial.println("[MOTION4] TEST FWD");
    updateLcdQuad();
}

void testReverse4() {
    servo4StopNow();
    currentCycle4 = 0;
    motionState4 = STATE_MANUAL_REVERSE;
    state4StartedAt = millis();
    servo4ReverseNow();
    Serial.println("[MOTION4] TEST REV");
    updateLcdQuad();
}

// Aliases for compatibility
void startMotion() { startMotion1(); }
void startOpen() { startOpen1(); }
void startClose() { startClose1(); }
void stopMotion() { stopMotion1(); }

// --- FIFO COLUMN DISPENSE MASTER ACTIONS ---
void startAll() {
    startMotion1();
    startMotion2();
    startMotion3();
    startMotion4();
}

void stopAll() {
    stopMotion1();
    stopMotion2();
    stopMotion3();
    stopMotion4();
    col1DispenseState = COL_IDLE;
    col2DispenseState = COL_IDLE;
}

void openAll() {
    startOpen1();
    startOpen2();
    startOpen3();
    startOpen4();
}

void closeAll() {
    startClose1();
    startClose2();
    startClose3();
    startClose4();
}

// ============================================================
// 11. MOTION STATE MACHINE TIMING LOOPS
// ============================================================

void updateMotion1() {
    if (!motionIsRunning(motionState1)) return;
    unsigned long elapsed = millis() - state1StartedAt;

    switch (motionState1) {
        case STATE_FORWARD:
            if (elapsed >= forwardMs1) {
                servo1StopNow();
                motionState1 = STATE_PAUSE_AFTER_FORWARD;
                state1StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_PAUSE_AFTER_FORWARD:
            if (elapsed >= pauseMs1) {
                servo1ReverseNow();
                motionState1 = STATE_REVERSE;
                state1StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_REVERSE:
            if (elapsed >= reverseMs1) {
                servo1StopNow();
                motionState1 = STATE_PAUSE_AFTER_REVERSE;
                state1StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_PAUSE_AFTER_REVERSE:
            if (elapsed >= pauseMs1) {
                if (currentCycle1 >= cycles1) {
                    servo1StopNow();
                    motionState1 = STATE_COMPLETE;
                    state1StartedAt = millis();
                    Serial.println("[MOTION1] COMPLETE");
                    updateLcdQuad();
                } else {
                    currentCycle1++;
                    motionState1 = STATE_FORWARD;
                    state1StartedAt = millis();
                    servo1ForwardNow();
                    updateLcdQuad();
                }
            }
            break;

        case STATE_OPENING:
            if (elapsed >= forwardMs1) {
                servo1StopNow();
                motionState1 = STATE_OPENED;
                state1StartedAt = millis();
                Serial.println("[MOTION1] OPENED -> HOLDING");
                updateLcdQuad();
            }
            break;

        case STATE_CLOSING:
            if (elapsed >= reverseMs1) {
                servo1StopNow();
                motionState1 = STATE_CLOSED;
                state1StartedAt = millis();
                Serial.println("[MOTION1] CLOSED -> HOLDING");
                updateLcdQuad();
            }
            break;

        default:
            break;
    }
}

void updateMotion2() {
    if (!motionIsRunning(motionState2)) return;
    unsigned long elapsed = millis() - state2StartedAt;

    switch (motionState2) {
        case STATE_FORWARD:
            if (elapsed >= forwardMs2) {
                servo2StopNow();
                motionState2 = STATE_PAUSE_AFTER_FORWARD;
                state2StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_PAUSE_AFTER_FORWARD:
            if (elapsed >= pauseMs2) {
                servo2ReverseNow();
                motionState2 = STATE_REVERSE;
                state2StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_REVERSE:
            if (elapsed >= reverseMs2) {
                servo2StopNow();
                motionState2 = STATE_PAUSE_AFTER_REVERSE;
                state2StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_PAUSE_AFTER_REVERSE:
            if (elapsed >= pauseMs2) {
                if (currentCycle2 >= cycles2) {
                    servo2StopNow();
                    motionState2 = STATE_COMPLETE;
                    state2StartedAt = millis();
                    Serial.println("[MOTION2] COMPLETE");
                    updateLcdQuad();
                } else {
                    currentCycle2++;
                    motionState2 = STATE_FORWARD;
                    state2StartedAt = millis();
                    servo2ForwardNow();
                    updateLcdQuad();
                }
            }
            break;

        case STATE_OPENING:
            if (elapsed >= forwardMs2) {
                servo2StopNow();
                motionState2 = STATE_OPENED;
                state2StartedAt = millis();
                Serial.println("[MOTION2] OPENED -> HOLDING");
                updateLcdQuad();
            }
            break;

        case STATE_CLOSING:
            if (elapsed >= reverseMs2) {
                servo2StopNow();
                motionState2 = STATE_CLOSED;
                state2StartedAt = millis();
                Serial.println("[MOTION2] CLOSED -> HOLDING");
                updateLcdQuad();
            }
            break;

        default:
            break;
    }
}

void updateMotion3() {
    if (!motionIsRunning(motionState3)) return;
    unsigned long elapsed = millis() - state3StartedAt;

    switch (motionState3) {
        case STATE_FORWARD:
            if (elapsed >= forwardMs3) {
                servo3StopNow();
                motionState3 = STATE_PAUSE_AFTER_FORWARD;
                state3StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_PAUSE_AFTER_FORWARD:
            if (elapsed >= pauseMs3) {
                servo3ReverseNow();
                motionState3 = STATE_REVERSE;
                state3StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_REVERSE:
            if (elapsed >= reverseMs3) {
                servo3StopNow();
                motionState3 = STATE_PAUSE_AFTER_REVERSE;
                state3StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_PAUSE_AFTER_REVERSE:
            if (elapsed >= pauseMs3) {
                if (currentCycle3 >= cycles3) {
                    servo3StopNow();
                    motionState3 = STATE_COMPLETE;
                    state3StartedAt = millis();
                    Serial.println("[MOTION3] COMPLETE");
                    updateLcdQuad();
                } else {
                    currentCycle3++;
                    motionState3 = STATE_FORWARD;
                    state3StartedAt = millis();
                    servo3ForwardNow();
                    updateLcdQuad();
                }
            }
            break;

        case STATE_OPENING:
            if (elapsed >= forwardMs3) {
                servo3StopNow();
                motionState3 = STATE_OPENED;
                state3StartedAt = millis();
                Serial.println("[MOTION3] OPENED -> HOLDING");
                updateLcdQuad();
            }
            break;

        case STATE_CLOSING:
            if (elapsed >= reverseMs3) {
                servo3StopNow();
                motionState3 = STATE_CLOSED;
                state3StartedAt = millis();
                Serial.println("[MOTION3] CLOSED -> HOLDING");
                updateLcdQuad();
            }
            break;

        default:
            break;
    }
}

void updateMotion4() {
    if (!motionIsRunning(motionState4)) return;
    unsigned long elapsed = millis() - state4StartedAt;

    switch (motionState4) {
        case STATE_FORWARD:
            if (elapsed >= forwardMs4) {
                servo4StopNow();
                motionState4 = STATE_PAUSE_AFTER_FORWARD;
                state4StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_PAUSE_AFTER_FORWARD:
            if (elapsed >= pauseMs4) {
                servo4ReverseNow();
                motionState4 = STATE_REVERSE;
                state4StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_REVERSE:
            if (elapsed >= reverseMs4) {
                servo4StopNow();
                motionState4 = STATE_PAUSE_AFTER_REVERSE;
                state4StartedAt = millis();
                updateLcdQuad();
            }
            break;

        case STATE_PAUSE_AFTER_REVERSE:
            if (elapsed >= pauseMs4) {
                if (currentCycle4 >= cycles4) {
                    servo4StopNow();
                    motionState4 = STATE_COMPLETE;
                    state4StartedAt = millis();
                    Serial.println("[MOTION4] COMPLETE");
                    updateLcdQuad();
                } else {
                    currentCycle4++;
                    motionState4 = STATE_FORWARD;
                    state4StartedAt = millis();
                    servo4ForwardNow();
                    updateLcdQuad();
                }
            }
            break;

        case STATE_OPENING:
            if (elapsed >= forwardMs4) {
                servo4StopNow();
                motionState4 = STATE_OPENED;
                state4StartedAt = millis();
                Serial.println("[MOTION4] OPENED -> HOLDING");
                updateLcdQuad();
            }
            break;

        case STATE_CLOSING:
            if (elapsed >= reverseMs4) {
                servo4StopNow();
                motionState4 = STATE_CLOSED;
                state4StartedAt = millis();
                Serial.println("[MOTION4] CLOSED -> HOLDING");
                updateLcdQuad();
            }
            break;

        default:
            break;
    }
}

// --- FIFO COLUMN DISPENSE ENGINE ---
void updateMotion() {
    updateMotion1();
    updateMotion2();
    updateMotion3();
    updateMotion4();
    updateColumnDispense();
}

// ============================================================
