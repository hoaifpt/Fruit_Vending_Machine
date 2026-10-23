#include "core/runtime_api.hpp"

// 8. LCD DISPLAY DRIVER
// ============================================================

void lcdShow(
    String title,
    String line1,
    String line2,
    String line3
) {
    if (!gfx) return;
    gfx->fillScreen(COLOR_BLACK);
    gfx->setTextColor(COLOR_CYAN);
    gfx->setTextSize(2);
    gfx->setCursor(10, 16);
    gfx->println(title);

    gfx->setTextSize(1);
    gfx->setTextColor(COLOR_WHITE);

    if (line1.length() > 0) {
        gfx->setCursor(10, 50);
        gfx->println(line1);
    }
    if (line2.length() > 0) {
        gfx->setCursor(10, 75);
        gfx->println(line2);
    }
    if (line3.length() > 0) {
        gfx->setCursor(10, 100);
        gfx->println(line3);
    }
}

void updateLcdQuad() {
    if (!gfx) return;
    gfx->fillScreen(COLOR_BLACK);
    gfx->setTextColor(COLOR_CYAN);
    gfx->setTextSize(2);
    gfx->setCursor(10, 10);
    gfx->println("ESP32 QUAD SERVO");

    gfx->setTextSize(1);
    // S1 Line (Column 1 Lower)
    gfx->setTextColor(motionIsRunning(motionState1) ? COLOR_GREEN : COLOR_YELLOW);
    gfx->setCursor(10, 34);
    gfx->println("S1(C1-Low): " + motionStateText(motionState1) + " (" + String(currentCycle1) + "/" + String(cycles1) + ")");

    // S2 Line (Column 1 Upper)
    gfx->setTextColor(motionIsRunning(motionState2) ? COLOR_GREEN : COLOR_YELLOW);
    gfx->setCursor(10, 54);
    gfx->println("S2(C1-Up) : " + motionStateText(motionState2) + " (" + String(currentCycle2) + "/" + String(cycles2) + ")");

    // S3 Line (Column 2 Lower)
    gfx->setTextColor(motionIsRunning(motionState3) ? COLOR_GREEN : COLOR_ORANGE);
    gfx->setCursor(10, 74);
    gfx->println("S3(C2-Low): " + motionStateText(motionState3) + " (" + String(currentCycle3) + "/" + String(cycles3) + ")");

    // S4 Line (Column 2 Upper)
    gfx->setTextColor(motionIsRunning(motionState4) ? COLOR_GREEN : COLOR_ORANGE);
    gfx->setCursor(10, 94);
    gfx->println("S4(C2-Up) : " + motionStateText(motionState4) + " (" + String(currentCycle4) + "/" + String(cycles4) + ")");

    // IR Bowl Sensor Line
    gfx->setTextColor(irDetected ? COLOR_RED : COLOR_GREEN);
    gfx->setCursor(10, 114);
    gfx->println("IR(G10): " + String(irDetected ? "TO DI QUA! [DETECTED]" : "THONG SUOT [CLEAR]") + " #" + String(irObjectCount));

    // Status / IP line
    gfx->setTextColor(COLOR_WHITE);
    gfx->setCursor(10, 134);
    if (col1DispenseState != COL_IDLE) {
        gfx->println("DISPENSE C1: " + colDispenseStateText(col1DispenseState));
    } else if (col2DispenseState != COL_IDLE) {
        gfx->println("DISPENSE C2: " + colDispenseStateText(col2DispenseState));
    } else {
        gfx->println("AP: " + WiFi.softAPIP().toString() + (irAutoTriggerServo > 0 ? " [AUTO]" : ""));
    }
}

// Backwards compatibility alias
void updateLcdDual() {
    updateLcdQuad();
}

// ============================================================
