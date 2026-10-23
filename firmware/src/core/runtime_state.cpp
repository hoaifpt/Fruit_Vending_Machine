#include "core/runtime_state.hpp"

#if HAS_ST7789_PARALLEL_LCD
Arduino_DataBus *bus = new Arduino_ESP32PAR8Q(
    7, 6, 8, 9,
    39, 40, 41, 42,
    45, 46, 47, 48
);
Arduino_GFX *gfx = new Arduino_ST7789(
    bus,
    5,
    0,
    true,
    170,
    320,
    35, 0, 35, 0
);
#else
Arduino_DataBus *bus = nullptr;
Arduino_GFX *gfx = nullptr;
#endif
const char *AP_SSID = "ESP32-Servo-Quad";
const char *AP_PASSWORD = "12345678";
WebServer server(80);
Preferences preferences;
Servo servo1;
bool servo1Attached = false;
Servo servo2;
bool servo2Attached = false;
Servo servo3;
bool servo3Attached = false;
Servo servo4;
bool servo4Attached = false;
int servo1Stop = 90;
int servo1Forward = 110;
int servo1Reverse = 70;
unsigned long forwardMs1 = 1000;
unsigned long reverseMs1 = 1000;
unsigned long pauseMs1 = 500;
int cycles1 = 1;
int servo2Stop = 90;
int servo2Forward = 110;
int servo2Reverse = 70;
unsigned long forwardMs2 = 1000;
unsigned long reverseMs2 = 1000;
unsigned long pauseMs2 = 500;
int cycles2 = 1;
int servo3Stop = 90;
int servo3Forward = 110;
int servo3Reverse = 70;
unsigned long forwardMs3 = 1000;
unsigned long reverseMs3 = 1000;
unsigned long pauseMs3 = 500;
int cycles3 = 1;
int servo4Stop = 90;
int servo4Forward = 110;
int servo4Reverse = 70;
unsigned long forwardMs4 = 1000;
unsigned long reverseMs4 = 1000;
unsigned long pauseMs4 = 500;
int cycles4 = 1;
bool irDetected = false;
int irRawValue = HIGH;
bool irActiveLow = true;
uint32_t irObjectCount = 0;
unsigned long irLastDetectionMs = 0;
unsigned long irBlockStartMs = 0;
unsigned long irBlockDurationMs = 0;
int irAutoTriggerServo = 0;
bool irTxEnabled = true;
unsigned long irDebounceMs = 60;
unsigned long irLastStateChangeMs = 0;
bool irStableReading = false;
MotionState motionState1 = STATE_IDLE;
unsigned long state1StartedAt = 0;
int currentCycle1 = 0;
MotionState motionState2 = STATE_IDLE;
unsigned long state2StartedAt = 0;
int currentCycle2 = 0;
MotionState motionState3 = STATE_IDLE;
unsigned long state3StartedAt = 0;
int currentCycle3 = 0;
MotionState motionState4 = STATE_IDLE;
unsigned long state4StartedAt = 0;
int currentCycle4 = 0;
ColumnDispenseState col1DispenseState = COL_IDLE;
unsigned long col1DispenseStartedAt = 0;
ColumnDispenseState col2DispenseState = COL_IDLE;
unsigned long col2DispenseStartedAt = 0;
