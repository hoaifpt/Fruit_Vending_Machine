#pragma once
#include "config/board_pins.hpp"
// -----------------------------
// 2. LCD CONFIGURATION
// -----------------------------
#define COLOR_BLACK     0x0000
#define COLOR_WHITE     0xFFFF
#define COLOR_RED       0xF800
#define COLOR_GREEN     0x07E0
#define COLOR_BLUE      0x001F
#define COLOR_YELLOW    0xFFE0
#define COLOR_CYAN      0x07FF
#define COLOR_ORANGE    0xFD20
#define COLOR_PURPLE    0x780F

#if HAS_ST7789_PARALLEL_LCD
extern Arduino_DataBus *bus;

extern Arduino_GFX *gfx;
#else
extern Arduino_DataBus *bus;
extern Arduino_GFX *gfx;
#endif

// -----------------------------
// 3. WIFI / WEB SERVER
// -----------------------------
extern const char *AP_SSID;
extern const char *AP_PASSWORD;

extern WebServer server;
extern Preferences preferences;

extern Servo servo1;
extern bool servo1Attached;

extern Servo servo2;
extern bool servo2Attached;

extern Servo servo3;
extern bool servo3Attached;

extern Servo servo4;
extern bool servo4Attached;

// Backwards compatibility aliases
#define servo servo1
#define servoAttached servo1Attached

static const uint32_t CONFIG_SCHEMA_VERSION = 6;

// -----------------------------
// 4. QUAD SERVO CONFIGURATION
// -----------------------------
// Servo 1 (Col 1 Lower Gate):
extern int servo1Stop;
extern int servo1Forward;
extern int servo1Reverse;
extern unsigned long forwardMs1;
extern unsigned long reverseMs1;
extern unsigned long pauseMs1;
extern int cycles1;

// Servo 2 (Col 1 Upper Gate):
extern int servo2Stop;
extern int servo2Forward;
extern int servo2Reverse;
extern unsigned long forwardMs2;
extern unsigned long reverseMs2;
extern unsigned long pauseMs2;
extern int cycles2;

// Servo 3 (Col 2 Lower Gate):
extern int servo3Stop;
extern int servo3Forward;
extern int servo3Reverse;
extern unsigned long forwardMs3;
extern unsigned long reverseMs3;
extern unsigned long pauseMs3;
extern int cycles3;

// Servo 4 (Col 2 Upper Gate):
extern int servo4Stop;
extern int servo4Forward;
extern int servo4Reverse;
extern unsigned long forwardMs4;
extern unsigned long reverseMs4;
extern unsigned long pauseMs4;
extern int cycles4;

// -----------------------------
// 4B. IR SENSOR & BOWL DETECTION
// -----------------------------
extern bool irDetected;            // True when bowl/object is detected
extern int irRawValue;              // Raw reading from GPIO 10
extern bool irActiveLow;            // Standard optical sensor: LOW when beam broken
extern uint32_t irObjectCount;         // Total bowls/objects passed
extern unsigned long irLastDetectionMs;// Timestamp of last detection
extern unsigned long irBlockStartMs;   // When current beam block started
extern unsigned long irBlockDurationMs;// How long beam has been blocked
extern int irAutoTriggerServo;         // 0: Disabled, 1: Auto S1, 2: Auto S2, 3: Auto Both, 4: Col 1 Dispense, 5: Col 2 Dispense
extern bool irTxEnabled;            // IR Transmitter power state
extern unsigned long irDebounceMs;    // Non-blocking debounce time in ms
extern unsigned long irLastStateChangeMs;
extern bool irStableReading;

// Compatibility aliases
#define servoStop servo1Stop
#define servoForward servo1Forward
#define servoReverse servo1Reverse
#define forwardMs forwardMs1
#define reverseMs reverseMs1
#define pauseMs pauseMs1
#define cycles cycles1

// -----------------------------
// 5. LIMITS
// -----------------------------
static const int SERVO_VALUE_MIN = 0;
static const int SERVO_VALUE_MAX = 180;
static const unsigned long MOTION_TIME_MIN = 1;
static const unsigned long MOTION_TIME_MAX = 600000UL; // 10 min
static const int CYCLES_MIN = 1;
static const int CYCLES_MAX = 1000;

// -----------------------------
// 6. STATE MACHINES
// -----------------------------
enum MotionState {
    STATE_IDLE,
    STATE_FORWARD,
    STATE_PAUSE_AFTER_FORWARD,
    STATE_REVERSE,
    STATE_PAUSE_AFTER_REVERSE,
    STATE_MANUAL_FORWARD,
    STATE_MANUAL_REVERSE,
    STATE_OPENING,
    STATE_OPENED,
    STATE_CLOSING,
    STATE_CLOSED,
    STATE_COMPLETE,
    STATE_ERROR
};

enum ColumnDispenseState {
    COL_IDLE,
    COL_DISPENSE_LOWER_OPEN,
    COL_DISPENSE_LOWER_HOLD,
    COL_DISPENSE_LOWER_CLOSE,
    COL_DISPENSE_PAUSE_MID,
    COL_DISPENSE_UPPER_OPEN,
    COL_DISPENSE_UPPER_HOLD,
    COL_DISPENSE_UPPER_CLOSE,
    COL_DISPENSE_COMPLETE
};

extern MotionState motionState1;
extern unsigned long state1StartedAt;
extern int currentCycle1;

extern MotionState motionState2;
extern unsigned long state2StartedAt;
extern int currentCycle2;

extern MotionState motionState3;
extern unsigned long state3StartedAt;
extern int currentCycle3;

extern MotionState motionState4;
extern unsigned long state4StartedAt;
extern int currentCycle4;

extern ColumnDispenseState col1DispenseState;
extern unsigned long col1DispenseStartedAt;

extern ColumnDispenseState col2DispenseState;
extern unsigned long col2DispenseStartedAt;

#define motionState motionState1
#define stateStartedAt state1StartedAt
#define currentCycle currentCycle1

// ============================================================
