#include "core/runtime_api.hpp"

void startDispenseCol1() {
    stopMotion1();
    stopMotion2();
    col1DispenseState = COL_DISPENSE_LOWER_OPEN;
    col1DispenseStartedAt = millis();
    startOpen1();
    Serial.println("[COL1] START FIFO DISPENSE SEQUENCE (Column 1: Tao - Apple)");
    updateLcdQuad();
}

void startDispenseCol2() {
    stopMotion3();
    stopMotion4();
    col2DispenseState = COL_DISPENSE_LOWER_OPEN;
    col2DispenseStartedAt = millis();
    startOpen3();
    Serial.println("[COL2] START FIFO DISPENSE SEQUENCE (Column 2: Dua Luoi - Melon)");
    updateLcdQuad();
}

// --- COMBINED MASTER ACTIONS (ALL 4 SERVOS) ---
void updateColumnDispense() {
    unsigned long now = millis();

    // Column 1 Sequence: S1 (Lower) and S2 (Upper)
    if (col1DispenseState != COL_IDLE) {
        unsigned long elapsed = now - col1DispenseStartedAt;
        switch (col1DispenseState) {
            case COL_DISPENSE_LOWER_OPEN:
                if (motionState1 == STATE_OPENED || elapsed >= forwardMs1) {
                    col1DispenseState = COL_DISPENSE_LOWER_HOLD;
                    col1DispenseStartedAt = now;
                    Serial.println("[COL1] LOWER GATE OPENED -> HOLDING FOR BOWL RELEASE");
                }
                break;

            case COL_DISPENSE_LOWER_HOLD:
                // Hold open 600ms so bowl falls down
                if (elapsed >= 600) {
                    startClose1();
                    col1DispenseState = COL_DISPENSE_LOWER_CLOSE;
                    col1DispenseStartedAt = now;
                    Serial.println("[COL1] CLOSING LOWER GATE");
                }
                break;

            case COL_DISPENSE_LOWER_CLOSE:
                if (motionState1 == STATE_CLOSED || elapsed >= reverseMs1) {
                    col1DispenseState = COL_DISPENSE_PAUSE_MID;
                    col1DispenseStartedAt = now;
                    Serial.println("[COL1] LOWER GATE CLOSED -> PAUSING BEFORE UPPER REFILL");
                }
                break;

            case COL_DISPENSE_PAUSE_MID:
                if (elapsed >= 300) {
                    startOpen2(); // Open Upper Gate to refill
                    col1DispenseState = COL_DISPENSE_UPPER_OPEN;
                    col1DispenseStartedAt = now;
                    Serial.println("[COL1] OPENING UPPER GATE TO REFILL NEXT BOWL");
                }
                break;

            case COL_DISPENSE_UPPER_OPEN:
                if (motionState2 == STATE_OPENED || elapsed >= forwardMs2) {
                    col1DispenseState = COL_DISPENSE_UPPER_HOLD;
                    col1DispenseStartedAt = now;
                    Serial.println("[COL1] UPPER GATE OPENED -> HOLDING FOR REFILL DROP");
                }
                break;

            case COL_DISPENSE_UPPER_HOLD:
                if (elapsed >= 600) {
                    startClose2();
                    col1DispenseState = COL_DISPENSE_UPPER_CLOSE;
                    col1DispenseStartedAt = now;
                    Serial.println("[COL1] CLOSING UPPER GATE TO LOCK COLUMN");
                }
                break;

            case COL_DISPENSE_UPPER_CLOSE:
                if (motionState2 == STATE_CLOSED || elapsed >= reverseMs2) {
                    col1DispenseState = COL_IDLE;
                    Serial.println("[COL1] FIFO DISPENSE & REFILL SUCCESSFUL!");
                    updateLcdQuad();
                }
                break;

            default:
                col1DispenseState = COL_IDLE;
                break;
        }
    }

    // Column 2 Sequence: S3 (Lower) and S4 (Upper)
    if (col2DispenseState != COL_IDLE) {
        unsigned long elapsed = now - col2DispenseStartedAt;
        switch (col2DispenseState) {
            case COL_DISPENSE_LOWER_OPEN:
                if (motionState3 == STATE_OPENED || elapsed >= forwardMs3) {
                    col2DispenseState = COL_DISPENSE_LOWER_HOLD;
                    col2DispenseStartedAt = now;
                    Serial.println("[COL2] LOWER GATE OPENED -> HOLDING FOR BOWL RELEASE");
                }
                break;

            case COL_DISPENSE_LOWER_HOLD:
                if (elapsed >= 600) {
                    startClose3();
                    col2DispenseState = COL_DISPENSE_LOWER_CLOSE;
                    col2DispenseStartedAt = now;
                    Serial.println("[COL2] CLOSING LOWER GATE");
                }
                break;

            case COL_DISPENSE_LOWER_CLOSE:
                if (motionState3 == STATE_CLOSED || elapsed >= reverseMs3) {
                    col2DispenseState = COL_DISPENSE_PAUSE_MID;
                    col2DispenseStartedAt = now;
                    Serial.println("[COL2] LOWER GATE CLOSED -> PAUSING BEFORE UPPER REFILL");
                }
                break;

            case COL_DISPENSE_PAUSE_MID:
                if (elapsed >= 300) {
                    startOpen4(); // Open Upper Gate to refill
                    col2DispenseState = COL_DISPENSE_UPPER_OPEN;
                    col2DispenseStartedAt = now;
                    Serial.println("[COL2] OPENING UPPER GATE TO REFILL NEXT BOWL");
                }
                break;

            case COL_DISPENSE_UPPER_OPEN:
                if (motionState4 == STATE_OPENED || elapsed >= forwardMs4) {
                    col2DispenseState = COL_DISPENSE_UPPER_HOLD;
                    col2DispenseStartedAt = now;
                    Serial.println("[COL2] UPPER GATE OPENED -> HOLDING FOR REFILL DROP");
                }
                break;

            case COL_DISPENSE_UPPER_HOLD:
                if (elapsed >= 600) {
                    startClose4();
                    col2DispenseState = COL_DISPENSE_UPPER_CLOSE;
                    col2DispenseStartedAt = now;
                    Serial.println("[COL2] CLOSING UPPER GATE TO LOCK COLUMN");
                }
                break;

            case COL_DISPENSE_UPPER_CLOSE:
                if (motionState4 == STATE_CLOSED || elapsed >= reverseMs4) {
                    col2DispenseState = COL_IDLE;
                    Serial.println("[COL2] FIFO DISPENSE & REFILL SUCCESSFUL!");
                    updateLcdQuad();
                }
                break;

            default:
                col2DispenseState = COL_IDLE;
                break;
        }
    }
}

