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

// -----------------------------
// 3. WIFI / WEB SERVER
// -----------------------------
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

// Backwards compatibility aliases
#define servo servo1
#define servoAttached servo1Attached

static const uint32_t CONFIG_SCHEMA_VERSION = 6;

// -----------------------------
// 4. QUAD SERVO CONFIGURATION
// -----------------------------
// Servo 1 (Col 1 Lower Gate):
int servo1Stop = 90;
int servo1Forward = 110;
int servo1Reverse = 70;
unsigned long forwardMs1 = 1000;
unsigned long reverseMs1 = 1000;
unsigned long pauseMs1 = 500;
int cycles1 = 1;

// Servo 2 (Col 1 Upper Gate):
int servo2Stop = 90;
int servo2Forward = 110;
int servo2Reverse = 70;
unsigned long forwardMs2 = 1000;
unsigned long reverseMs2 = 1000;
unsigned long pauseMs2 = 500;
int cycles2 = 1;

// Servo 3 (Col 2 Lower Gate):
int servo3Stop = 90;
int servo3Forward = 110;
int servo3Reverse = 70;
unsigned long forwardMs3 = 1000;
unsigned long reverseMs3 = 1000;
unsigned long pauseMs3 = 500;
int cycles3 = 1;

// Servo 4 (Col 2 Upper Gate):
int servo4Stop = 90;
int servo4Forward = 110;
int servo4Reverse = 70;
unsigned long forwardMs4 = 1000;
unsigned long reverseMs4 = 1000;
unsigned long pauseMs4 = 500;
int cycles4 = 1;

// -----------------------------
// 4B. IR SENSOR & BOWL DETECTION
// -----------------------------
bool irDetected = false;            // True when bowl/object is detected
int irRawValue = HIGH;              // Raw reading from GPIO 10
bool irActiveLow = true;            // Standard optical sensor: LOW when beam broken
uint32_t irObjectCount = 0;         // Total bowls/objects passed
unsigned long irLastDetectionMs = 0;// Timestamp of last detection
unsigned long irBlockStartMs = 0;   // When current beam block started
unsigned long irBlockDurationMs = 0;// How long beam has been blocked
int irAutoTriggerServo = 0;         // 0: Disabled, 1: Auto S1, 2: Auto S2, 3: Auto Both, 4: Col 1 Dispense, 5: Col 2 Dispense
bool irTxEnabled = true;            // IR Transmitter power state
unsigned long irDebounceMs = 60;    // Non-blocking debounce time in ms
unsigned long irLastStateChangeMs = 0;
bool irStableReading = false;

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

#define motionState motionState1
#define stateStartedAt state1StartedAt
#define currentCycle currentCycle1

// ============================================================
// 7. HELPERS
// ============================================================

String jsonEscape(const String &value) {
    String out;
    out.reserve(value.length() + 8);
    for (size_t i = 0; i < value.length(); ++i) {
        const char c = value[i];
        if (c == '\\') out += "\\\\";
        else if (c == '"') out += "\\\"";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else out += c;
    }
    return out;
}

String motionStateText(MotionState st) {
    switch (st) {
        case STATE_IDLE:                    return "San sang";
        case STATE_FORWARD:                 return "Dang quay thuan";
        case STATE_PAUSE_AFTER_FORWARD:     return "Dang dung";
        case STATE_REVERSE:                 return "Dang quay nghich";
        case STATE_PAUSE_AFTER_REVERSE:     return "Dang dung";
        case STATE_MANUAL_FORWARD:          return "Test thuan";
        case STATE_MANUAL_REVERSE:          return "Test nghich";
        case STATE_OPENING:                 return "Dang mo";
        case STATE_OPENED:                  return "Da mo";
        case STATE_CLOSING:                 return "Dang dong";
        case STATE_CLOSED:                  return "Da dong";
        case STATE_COMPLETE:                return "Hoan thanh";
        case STATE_ERROR:                   return "Loi";
        default:                            return "Khong xac dinh";
    }
}

String colDispenseStateText(ColumnDispenseState st) {
    switch (st) {
        case COL_IDLE:                     return "San sang";
        case COL_DISPENSE_LOWER_OPEN:      return "Mo servo duoi";
        case COL_DISPENSE_LOWER_HOLD:      return "Nha to ra";
        case COL_DISPENSE_LOWER_CLOSE:     return "Dong servo duoi";
        case COL_DISPENSE_PAUSE_MID:       return "Tam dung giua";
        case COL_DISPENSE_UPPER_OPEN:      return "Mo servo tren";
        case COL_DISPENSE_UPPER_HOLD:      return "To tren roi xuong";
        case COL_DISPENSE_UPPER_CLOSE:     return "Khoa servo tren";
        case COL_DISPENSE_COMPLETE:        return "Hoan tat tra do";
        default:                           return "IDLE";
    }
}

String motionStateText() {
    return motionStateText(motionState1);
}

bool motionIsRunning(MotionState st) {
    return st == STATE_FORWARD ||
           st == STATE_PAUSE_AFTER_FORWARD ||
           st == STATE_REVERSE ||
           st == STATE_PAUSE_AFTER_REVERSE ||
           st == STATE_MANUAL_FORWARD ||
           st == STATE_MANUAL_REVERSE ||
           st == STATE_OPENING ||
           st == STATE_CLOSING;
}

bool motionIsRunning() {
    return motionIsRunning(motionState1) || motionIsRunning(motionState2) ||
           motionIsRunning(motionState3) || motionIsRunning(motionState4) ||
           col1DispenseState != COL_IDLE || col2DispenseState != COL_IDLE;
}

bool parseIntStrict(const String &text, int &value) {
    if (text.length() == 0) return false;
    char *endptr = nullptr;
    long v = strtol(text.c_str(), &endptr, 10);
    if (!endptr || *endptr != '\0') return false;
    value = (int)v;
    return true;
}

bool parseUnsignedLongStrict(const String &text, unsigned long &value) {
    if (text.length() == 0) return false;
    char *endptr = nullptr;
    unsigned long v = strtoul(text.c_str(), &endptr, 10);
    if (!endptr || *endptr != '\0') return false;
    value = v;
    return true;
}

void sendJsonError(int statusCode, const String &message) {
    String payload = "{";
    payload += "\"ok\":false,";
    payload += "\"error\":\"" + jsonEscape(message) + "\"";
    payload += "}";
    server.send(statusCode, "application/json; charset=utf-8", payload);
}

void sendJsonOk(const String &message = "") {
    String payload = "{";
    payload += "\"ok\":true";
    if (message.length() > 0) {
        payload += ",\"message\":\"" + jsonEscape(message) + "\"";
    }
    payload += "}";
    server.send(200, "application/json; charset=utf-8", payload);
}

// ============================================================
// 8. LCD DISPLAY DRIVER
// ============================================================

void lcdShow(
    String title,
    String line1 = "",
    String line2 = "",
    String line3 = ""
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

void updateMotion() {
    updateMotion1();
    updateMotion2();
    updateMotion3();
    updateMotion4();
    updateColumnDispense();
}

// ============================================================
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
// 12. PREFERENCES (NVS PERSISTENCE FOR 4 SERVOS)
// ============================================================

void setDefaultConfig() {
    // S1
    servo1Stop = 90;
    servo1Forward = 110;
    servo1Reverse = 70;
    forwardMs1 = 1000;
    reverseMs1 = 1000;
    pauseMs1 = 500;
    cycles1 = 1;

    // S2
    servo2Stop = 90;
    servo2Forward = 110;
    servo2Reverse = 70;
    forwardMs2 = 1000;
    reverseMs2 = 1000;
    pauseMs2 = 500;
    cycles2 = 1;

    // S3
    servo3Stop = 90;
    servo3Forward = 110;
    servo3Reverse = 70;
    forwardMs3 = 1000;
    reverseMs3 = 1000;
    pauseMs3 = 500;
    cycles3 = 1;

    // S4
    servo4Stop = 90;
    servo4Forward = 110;
    servo4Reverse = 70;
    forwardMs4 = 1000;
    reverseMs4 = 1000;
    pauseMs4 = 500;
    cycles4 = 1;

    irAutoTriggerServo = 0;
    irActiveLow = true;
}

void saveConfig() {
    preferences.begin("servo-config", false);
    preferences.putUInt("schema", CONFIG_SCHEMA_VERSION);

    // Servo 1
    preferences.putInt("stop1", servo1Stop);
    preferences.putInt("fwd1", servo1Forward);
    preferences.putInt("rev1", servo1Reverse);
    preferences.putULong("fwdMs1", forwardMs1);
    preferences.putULong("revMs1", reverseMs1);
    preferences.putULong("pauseMs1", pauseMs1);
    preferences.putInt("cycles1", cycles1);

    // Servo 2
    preferences.putInt("stop2", servo2Stop);
    preferences.putInt("fwd2", servo2Forward);
    preferences.putInt("rev2", servo2Reverse);
    preferences.putULong("fwdMs2", forwardMs2);
    preferences.putULong("revMs2", reverseMs2);
    preferences.putULong("pauseMs2", pauseMs2);
    preferences.putInt("cycles2", cycles2);

    // Servo 3
    preferences.putInt("stop3", servo3Stop);
    preferences.putInt("fwd3", servo3Forward);
    preferences.putInt("rev3", servo3Reverse);
    preferences.putULong("fwdMs3", forwardMs3);
    preferences.putULong("revMs3", reverseMs3);
    preferences.putULong("pauseMs3", pauseMs3);
    preferences.putInt("cycles3", cycles3);

    // Servo 4
    preferences.putInt("stop4", servo4Stop);
    preferences.putInt("fwd4", servo4Forward);
    preferences.putInt("rev4", servo4Reverse);
    preferences.putULong("fwdMs4", forwardMs4);
    preferences.putULong("revMs4", reverseMs4);
    preferences.putULong("pauseMs4", pauseMs4);
    preferences.putInt("cycles4", cycles4);

    // IR Sensor settings
    preferences.putInt("irAuto", irAutoTriggerServo);
    preferences.putBool("irActiveLow", irActiveLow);

    preferences.end();
    Serial.println("[CONFIG] Saved quad-servo (4 channels) and IR configuration to Preferences");
}

void loadConfig() {
    preferences.begin("servo-config", true);
    uint32_t schema = preferences.getUInt("schema", 0);

    if (schema != CONFIG_SCHEMA_VERSION) {
        preferences.end();
        setDefaultConfig();
        saveConfig();
        Serial.println("[CONFIG] Old/missing schema -> defaults applied for S1..S4 & IR");
        return;
    }

    // Load S1
    servo1Stop = preferences.getInt("stop1", 90);
    servo1Forward = preferences.getInt("fwd1", 110);
    servo1Reverse = preferences.getInt("rev1", 70);
    forwardMs1 = preferences.getULong("fwdMs1", 1000);
    reverseMs1 = preferences.getULong("revMs1", 1000);
    pauseMs1 = preferences.getULong("pauseMs1", 500);
    cycles1 = preferences.getInt("cycles1", 1);

    // Load S2
    servo2Stop = preferences.getInt("stop2", 90);
    servo2Forward = preferences.getInt("fwd2", 110);
    servo2Reverse = preferences.getInt("rev2", 70);
    forwardMs2 = preferences.getULong("fwdMs2", 1000);
    reverseMs2 = preferences.getULong("revMs2", 1000);
    pauseMs2 = preferences.getULong("pauseMs2", 500);
    cycles2 = preferences.getInt("cycles2", 1);

    // Load S3
    servo3Stop = preferences.getInt("stop3", 90);
    servo3Forward = preferences.getInt("fwd3", 110);
    servo3Reverse = preferences.getInt("rev3", 70);
    forwardMs3 = preferences.getULong("fwdMs3", 1000);
    reverseMs3 = preferences.getULong("revMs3", 1000);
    pauseMs3 = preferences.getULong("pauseMs3", 500);
    cycles3 = preferences.getInt("cycles3", 1);

    // Load S4
    servo4Stop = preferences.getInt("stop4", 90);
    servo4Forward = preferences.getInt("fwd4", 110);
    servo4Reverse = preferences.getInt("rev4", 70);
    forwardMs4 = preferences.getULong("fwdMs4", 1000);
    reverseMs4 = preferences.getULong("revMs4", 1000);
    pauseMs4 = preferences.getULong("pauseMs4", 500);
    cycles4 = preferences.getInt("cycles4", 1);

    // Load IR
    irAutoTriggerServo = preferences.getInt("irAuto", 0);
    irActiveLow = preferences.getBool("irActiveLow", true);

    preferences.end();

    // Constrain S1
    servo1Stop = constrain(servo1Stop, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo1Forward = constrain(servo1Forward, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo1Reverse = constrain(servo1Reverse, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    if (forwardMs1 < MOTION_TIME_MIN || forwardMs1 > MOTION_TIME_MAX) forwardMs1 = 1000;
    if (reverseMs1 < MOTION_TIME_MIN || reverseMs1 > MOTION_TIME_MAX) reverseMs1 = 1000;
    if (pauseMs1 > MOTION_TIME_MAX) pauseMs1 = 500;
    if (cycles1 < CYCLES_MIN || cycles1 > CYCLES_MAX) cycles1 = 1;

    // Constrain S2
    servo2Stop = constrain(servo2Stop, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo2Forward = constrain(servo2Forward, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo2Reverse = constrain(servo2Reverse, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    if (forwardMs2 < MOTION_TIME_MIN || forwardMs2 > MOTION_TIME_MAX) forwardMs2 = 1000;
    if (reverseMs2 < MOTION_TIME_MIN || reverseMs2 > MOTION_TIME_MAX) reverseMs2 = 1000;
    if (pauseMs2 > MOTION_TIME_MAX) pauseMs2 = 500;
    if (cycles2 < CYCLES_MIN || cycles2 > CYCLES_MAX) cycles2 = 1;

    // Constrain S3
    servo3Stop = constrain(servo3Stop, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo3Forward = constrain(servo3Forward, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo3Reverse = constrain(servo3Reverse, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    if (forwardMs3 < MOTION_TIME_MIN || forwardMs3 > MOTION_TIME_MAX) forwardMs3 = 1000;
    if (reverseMs3 < MOTION_TIME_MIN || reverseMs3 > MOTION_TIME_MAX) reverseMs3 = 1000;
    if (pauseMs3 > MOTION_TIME_MAX) pauseMs3 = 500;
    if (cycles3 < CYCLES_MIN || cycles3 > CYCLES_MAX) cycles3 = 1;

    // Constrain S4
    servo4Stop = constrain(servo4Stop, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo4Forward = constrain(servo4Forward, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo4Reverse = constrain(servo4Reverse, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    if (forwardMs4 < MOTION_TIME_MIN || forwardMs4 > MOTION_TIME_MAX) forwardMs4 = 1000;
    if (reverseMs4 < MOTION_TIME_MIN || reverseMs4 > MOTION_TIME_MAX) reverseMs4 = 1000;
    if (pauseMs4 > MOTION_TIME_MAX) pauseMs4 = 500;
    if (cycles4 < CYCLES_MIN || cycles4 > CYCLES_MAX) cycles4 = 1;

    Serial.println("[CONFIG] Quad-servo (4 channels) & IR configuration loaded");
}

// ============================================================
// 13. JSON SERIALIZERS
// ============================================================

String makeConfigJson() {
    String json = "{";
    json += "\"ok\":true,";
    json += "\"servoPin\":" + String(SERVO_1_PIN) + ",";
    json += "\"servoStop\":" + String(servo1Stop) + ",";
    json += "\"servoForward\":" + String(servo1Forward) + ",";
    json += "\"servoReverse\":" + String(servo1Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs1) + ",";
    json += "\"reverseMs\":" + String(reverseMs1) + ",";
    json += "\"pauseMs\":" + String(pauseMs1) + ",";
    json += "\"cycles\":" + String(cycles1) + ",";

    // Servo 1
    json += "\"s1\":{";
    json += "\"pin\":" + String(SERVO_1_PIN) + ",";
    json += "\"stop\":" + String(servo1Stop) + ",";
    json += "\"forward\":" + String(servo1Forward) + ",";
    json += "\"reverse\":" + String(servo1Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs1) + ",";
    json += "\"reverseMs\":" + String(reverseMs1) + ",";
    json += "\"pauseMs\":" + String(pauseMs1) + ",";
    json += "\"cycles\":" + String(cycles1);
    json += "},";

    // Servo 2
    json += "\"s2\":{";
    json += "\"pin\":" + String(SERVO_2_PIN) + ",";
    json += "\"stop\":" + String(servo2Stop) + ",";
    json += "\"forward\":" + String(servo2Forward) + ",";
    json += "\"reverse\":" + String(servo2Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs2) + ",";
    json += "\"reverseMs\":" + String(reverseMs2) + ",";
    json += "\"pauseMs\":" + String(pauseMs2) + ",";
    json += "\"cycles\":" + String(cycles2);
    json += "},";

    // Servo 3
    json += "\"s3\":{";
    json += "\"pin\":" + String(SERVO_3_PIN) + ",";
    json += "\"stop\":" + String(servo3Stop) + ",";
    json += "\"forward\":" + String(servo3Forward) + ",";
    json += "\"reverse\":" + String(servo3Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs3) + ",";
    json += "\"reverseMs\":" + String(reverseMs3) + ",";
    json += "\"pauseMs\":" + String(pauseMs3) + ",";
    json += "\"cycles\":" + String(cycles3);
    json += "},";

    // Servo 4
    json += "\"s4\":{";
    json += "\"pin\":" + String(SERVO_4_PIN) + ",";
    json += "\"stop\":" + String(servo4Stop) + ",";
    json += "\"forward\":" + String(servo4Forward) + ",";
    json += "\"reverse\":" + String(servo4Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs4) + ",";
    json += "\"reverseMs\":" + String(reverseMs4) + ",";
    json += "\"pauseMs\":" + String(pauseMs4) + ",";
    json += "\"cycles\":" + String(cycles4);
    json += "}";

    json += "}";
    return json;
}

String makeStatusJson() {
    String json = "{";
    json += "\"ok\":true,";
    json += "\"state\":\"" + jsonEscape(motionStateText(motionState1)) + "\",";
    json += "\"running\":" + String(motionIsRunning() ? "true" : "false") + ",";
    json += "\"cycle\":" + String(currentCycle1) + ",";
    json += "\"cycles\":" + String(cycles1) + ",";
    json += "\"servoStop\":" + String(servo1Stop) + ",";
    json += "\"servoForward\":" + String(servo1Forward) + ",";
    json += "\"servoReverse\":" + String(servo1Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs1) + ",";
    json += "\"reverseMs\":" + String(reverseMs1) + ",";
    json += "\"pauseMs\":" + String(pauseMs1) + ",";
    json += "\"ip\":\"" + jsonEscape(WiFi.softAPIP().toString()) + "\",";

    // Servo 1
    json += "\"s1\":{";
    json += "\"pin\":" + String(SERVO_1_PIN) + ",";
    json += "\"state\":\"" + jsonEscape(motionStateText(motionState1)) + "\",";
    json += "\"running\":" + String(motionIsRunning(motionState1) ? "true" : "false") + ",";
    json += "\"cycle\":" + String(currentCycle1) + ",";
    json += "\"cycles\":" + String(cycles1) + ",";
    json += "\"stop\":" + String(servo1Stop) + ",";
    json += "\"forward\":" + String(servo1Forward) + ",";
    json += "\"reverse\":" + String(servo1Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs1) + ",";
    json += "\"reverseMs\":" + String(reverseMs1) + ",";
    json += "\"pauseMs\":" + String(pauseMs1);
    json += "},";

    // Servo 2
    json += "\"s2\":{";
    json += "\"pin\":" + String(SERVO_2_PIN) + ",";
    json += "\"state\":\"" + jsonEscape(motionStateText(motionState2)) + "\",";
    json += "\"running\":" + String(motionIsRunning(motionState2) ? "true" : "false") + ",";
    json += "\"cycle\":" + String(currentCycle2) + ",";
    json += "\"cycles\":" + String(cycles2) + ",";
    json += "\"stop\":" + String(servo2Stop) + ",";
    json += "\"forward\":" + String(servo2Forward) + ",";
    json += "\"reverse\":" + String(servo2Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs2) + ",";
    json += "\"reverseMs\":" + String(reverseMs2) + ",";
    json += "\"pauseMs\":" + String(pauseMs2);
    json += "},";

    // Servo 3
    json += "\"s3\":{";
    json += "\"pin\":" + String(SERVO_3_PIN) + ",";
    json += "\"state\":\"" + jsonEscape(motionStateText(motionState3)) + "\",";
    json += "\"running\":" + String(motionIsRunning(motionState3) ? "true" : "false") + ",";
    json += "\"cycle\":" + String(currentCycle3) + ",";
    json += "\"cycles\":" + String(cycles3) + ",";
    json += "\"stop\":" + String(servo3Stop) + ",";
    json += "\"forward\":" + String(servo3Forward) + ",";
    json += "\"reverse\":" + String(servo3Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs3) + ",";
    json += "\"reverseMs\":" + String(reverseMs3) + ",";
    json += "\"pauseMs\":" + String(pauseMs3);
    json += "},";

    // Servo 4
    json += "\"s4\":{";
    json += "\"pin\":" + String(SERVO_4_PIN) + ",";
    json += "\"state\":\"" + jsonEscape(motionStateText(motionState4)) + "\",";
    json += "\"running\":" + String(motionIsRunning(motionState4) ? "true" : "false") + ",";
    json += "\"cycle\":" + String(currentCycle4) + ",";
    json += "\"cycles\":" + String(cycles4) + ",";
    json += "\"stop\":" + String(servo4Stop) + ",";
    json += "\"forward\":" + String(servo4Forward) + ",";
    json += "\"reverse\":" + String(servo4Reverse) + ",";
    json += "\"forwardMs\":" + String(forwardMs4) + ",";
    json += "\"reverseMs\":" + String(reverseMs4) + ",";
    json += "\"pauseMs\":" + String(pauseMs4);
    json += "},";

    // Columns
    json += "\"col1\":{";
    json += "\"state\":\"" + jsonEscape(colDispenseStateText(col1DispenseState)) + "\",";
    json += "\"running\":" + String(col1DispenseState != COL_IDLE ? "true" : "false");
    json += "},";

    json += "\"col2\":{";
    json += "\"state\":\"" + jsonEscape(colDispenseStateText(col2DispenseState)) + "\",";
    json += "\"running\":" + String(col2DispenseState != COL_IDLE ? "true" : "false");
    json += "},";

    // IR Sensor telemetry
    json += "\"ir\":{";
    json += "\"pin\":10,";
    json += "\"txPin\":11,";
    json += "\"detected\":" + String(irDetected ? "true" : "false") + ",";
    json += "\"raw\":" + String(irRawValue) + ",";
    json += "\"count\":" + String(irObjectCount) + ",";
    json += "\"blockMs\":" + String(irBlockDurationMs) + ",";
    json += "\"autoTrigger\":" + String(irAutoTriggerServo) + ",";
    json += "\"txEnabled\":" + String(irTxEnabled ? "true" : "false");
    json += "}";

    json += "}";
    return json;
}

// ============================================================
// 14. WEB UI HEADER
// ============================================================
#include "web_ui.h"

// ============================================================
// 15. API ROUTE HANDLERS
// ============================================================

void handleRoot() {
    server.send_P(200, "text/html; charset=utf-8", INDEX_HTML);
}

void handleStatus() {
    server.send(200, "application/json; charset=utf-8", makeStatusJson());
}

void handleGetConfig() {
    server.send(200, "application/json; charset=utf-8", makeConfigJson());
}

void handleFactoryReset() {
    if (motionIsRunning()) {
        sendJsonError(409, "Khong the khoi phuc khi Servo dang chay");
        return;
    }
    stopAll();
    setDefaultConfig();
    saveConfig();
    servo1StopNow();
    servo2StopNow();
    servo3StopNow();
    servo4StopNow();
    server.send(200, "application/json; charset=utf-8", makeConfigJson());
}

void handleConfig() {
    int pStop1 = servo1Stop, pFwd1 = servo1Forward, pRev1 = servo1Reverse, pCyc1 = cycles1;
    unsigned long pFwdMs1 = forwardMs1, pRevMs1 = reverseMs1, pPauseMs1 = pauseMs1;
    int pStop2 = servo2Stop, pFwd2 = servo2Forward, pRev2 = servo2Reverse, pCyc2 = cycles2;
    unsigned long pFwdMs2 = forwardMs2, pRevMs2 = reverseMs2, pPauseMs2 = pauseMs2;
    int pStop3 = servo3Stop, pFwd3 = servo3Forward, pRev3 = servo3Reverse, pCyc3 = cycles3;
    unsigned long pFwdMs3 = forwardMs3, pRevMs3 = reverseMs3, pPauseMs3 = pauseMs3;
    int pStop4 = servo4Stop, pFwd4 = servo4Forward, pRev4 = servo4Reverse, pCyc4 = cycles4;
    unsigned long pFwdMs4 = forwardMs4, pRevMs4 = reverseMs4, pPauseMs4 = pauseMs4;

    // S1 args
    if (server.hasArg("stop") || server.hasArg("stop1")) pStop1 = (server.hasArg("stop1") ? server.arg("stop1") : server.arg("stop")).toInt();
    if (server.hasArg("forward") || server.hasArg("forward1")) pFwd1 = (server.hasArg("forward1") ? server.arg("forward1") : server.arg("forward")).toInt();
    if (server.hasArg("reverse") || server.hasArg("reverse1")) pRev1 = (server.hasArg("reverse1") ? server.arg("reverse1") : server.arg("reverse")).toInt();
    if (server.hasArg("forwardMs") || server.hasArg("forwardMs1")) pFwdMs1 = strtoul((server.hasArg("forwardMs1") ? server.arg("forwardMs1") : server.arg("forwardMs")).c_str(), NULL, 10);
    if (server.hasArg("reverseMs") || server.hasArg("reverseMs1")) pRevMs1 = strtoul((server.hasArg("reverseMs1") ? server.arg("reverseMs1") : server.arg("reverseMs")).c_str(), NULL, 10);
    if (server.hasArg("pauseMs") || server.hasArg("pauseMs1")) pPauseMs1 = strtoul((server.hasArg("pauseMs1") ? server.arg("pauseMs1") : server.arg("pauseMs")).c_str(), NULL, 10);
    if (server.hasArg("cycles") || server.hasArg("cycles1")) pCyc1 = (server.hasArg("cycles1") ? server.arg("cycles1") : server.arg("cycles")).toInt();

    // S2 args
    if (server.hasArg("stop2")) pStop2 = server.arg("stop2").toInt();
    if (server.hasArg("forward2")) pFwd2 = server.arg("forward2").toInt();
    if (server.hasArg("reverse2")) pRev2 = server.arg("reverse2").toInt();
    if (server.hasArg("forwardMs2")) pFwdMs2 = strtoul(server.arg("forwardMs2").c_str(), NULL, 10);
    if (server.hasArg("reverseMs2")) pRevMs2 = strtoul(server.arg("reverseMs2").c_str(), NULL, 10);
    if (server.hasArg("pauseMs2")) pPauseMs2 = strtoul(server.arg("pauseMs2").c_str(), NULL, 10);
    if (server.hasArg("cycles2")) pCyc2 = server.arg("cycles2").toInt();

    // S3 args
    if (server.hasArg("stop3")) pStop3 = server.arg("stop3").toInt();
    if (server.hasArg("forward3")) pFwd3 = server.arg("forward3").toInt();
    if (server.hasArg("reverse3")) pRev3 = server.arg("reverse3").toInt();
    if (server.hasArg("forwardMs3")) pFwdMs3 = strtoul(server.arg("forwardMs3").c_str(), NULL, 10);
    if (server.hasArg("reverseMs3")) pRevMs3 = strtoul(server.arg("reverseMs3").c_str(), NULL, 10);
    if (server.hasArg("pauseMs3")) pPauseMs3 = strtoul(server.arg("pauseMs3").c_str(), NULL, 10);
    if (server.hasArg("cycles3")) pCyc3 = server.arg("cycles3").toInt();

    // S4 args
    if (server.hasArg("stop4")) pStop4 = server.arg("stop4").toInt();
    if (server.hasArg("forward4")) pFwd4 = server.arg("forward4").toInt();
    if (server.hasArg("reverse4")) pRev4 = server.arg("reverse4").toInt();
    if (server.hasArg("forwardMs4")) pFwdMs4 = strtoul(server.arg("forwardMs4").c_str(), NULL, 10);
    if (server.hasArg("reverseMs4")) pRevMs4 = strtoul(server.arg("reverseMs4").c_str(), NULL, 10);
    if (server.hasArg("pauseMs4")) pPauseMs4 = strtoul(server.arg("pauseMs4").c_str(), NULL, 10);
    if (server.hasArg("cycles4")) pCyc4 = server.arg("cycles4").toInt();

    if (motionIsRunning()) {
        sendJsonError(409, "Khong the luu khi Servo dang chay");
        return;
    }

    servo1Stop = constrain(pStop1, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo1Forward = constrain(pFwd1, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo1Reverse = constrain(pRev1, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    forwardMs1 = constrain(pFwdMs1, MOTION_TIME_MIN, MOTION_TIME_MAX);
    reverseMs1 = constrain(pRevMs1, MOTION_TIME_MIN, MOTION_TIME_MAX);
    pauseMs1 = constrain(pPauseMs1, 0UL, MOTION_TIME_MAX);
    cycles1 = constrain(pCyc1, CYCLES_MIN, CYCLES_MAX);

    servo2Stop = constrain(pStop2, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo2Forward = constrain(pFwd2, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo2Reverse = constrain(pRev2, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    forwardMs2 = constrain(pFwdMs2, MOTION_TIME_MIN, MOTION_TIME_MAX);
    reverseMs2 = constrain(pRevMs2, MOTION_TIME_MIN, MOTION_TIME_MAX);
    pauseMs2 = constrain(pPauseMs2, 0UL, MOTION_TIME_MAX);
    cycles2 = constrain(pCyc2, CYCLES_MIN, CYCLES_MAX);

    servo3Stop = constrain(pStop3, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo3Forward = constrain(pFwd3, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo3Reverse = constrain(pRev3, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    forwardMs3 = constrain(pFwdMs3, MOTION_TIME_MIN, MOTION_TIME_MAX);
    reverseMs3 = constrain(pRevMs3, MOTION_TIME_MIN, MOTION_TIME_MAX);
    pauseMs3 = constrain(pPauseMs3, 0UL, MOTION_TIME_MAX);
    cycles3 = constrain(pCyc3, CYCLES_MIN, CYCLES_MAX);

    servo4Stop = constrain(pStop4, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo4Forward = constrain(pFwd4, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    servo4Reverse = constrain(pRev4, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
    forwardMs4 = constrain(pFwdMs4, MOTION_TIME_MIN, MOTION_TIME_MAX);
    reverseMs4 = constrain(pRevMs4, MOTION_TIME_MIN, MOTION_TIME_MAX);
    pauseMs4 = constrain(pPauseMs4, 0UL, MOTION_TIME_MAX);
    cycles4 = constrain(pCyc4, CYCLES_MIN, CYCLES_MAX);

    saveConfig();
    servo1StopNow();
    servo2StopNow();
    servo3StopNow();
    servo4StopNow();
    server.send(200, "application/json; charset=utf-8", makeConfigJson());
}

// ============================================================
// 16. WEB SERVER SETUP (REST API FOR 4 SERVOS & 2 COLUMNS)
// ============================================================

void setupWebServer() {
    server.on("/", HTTP_GET, handleRoot);
    server.on("/api/status", HTTP_GET, handleStatus);
    server.on("/api/config", HTTP_GET, handleGetConfig);
    server.on("/api/config/reset", HTTP_POST, handleFactoryReset);
    server.on("/api/config", HTTP_POST, handleConfig);

    // Servo 1 endpoints (Column 1 Lower Gate)
    server.on("/api/s1/start", HTTP_POST, []() { startMotion1(); sendJsonOk("S1 da bat dau"); });
    server.on("/api/s1/stop", HTTP_POST, []() { stopMotion1(); sendJsonOk("S1 da dung"); });
    server.on("/api/s1/open", HTTP_POST, []() { startOpen1(); sendJsonOk("S1 dang mo"); });
    server.on("/api/s1/close", HTTP_POST, []() { startClose1(); sendJsonOk("S1 dang dong"); });
    server.on("/api/s1/test/forward", HTTP_POST, []() { testForward1(); sendJsonOk("S1 test thuan"); });
    server.on("/api/s1/test/reverse", HTTP_POST, []() { testReverse1(); sendJsonOk("S1 test nghich"); });

    // Servo 2 endpoints (Column 1 Upper Gate)
    server.on("/api/s2/start", HTTP_POST, []() { startMotion2(); sendJsonOk("S2 da bat dau"); });
    server.on("/api/s2/stop", HTTP_POST, []() { stopMotion2(); sendJsonOk("S2 da dung"); });
    server.on("/api/s2/open", HTTP_POST, []() { startOpen2(); sendJsonOk("S2 dang mo"); });
    server.on("/api/s2/close", HTTP_POST, []() { startClose2(); sendJsonOk("S2 dang dong"); });
    server.on("/api/s2/test/forward", HTTP_POST, []() { testForward2(); sendJsonOk("S2 test thuan"); });
    server.on("/api/s2/test/reverse", HTTP_POST, []() { testReverse2(); sendJsonOk("S2 test nghich"); });

    // Servo 3 endpoints (Column 2 Lower Gate)
    server.on("/api/s3/start", HTTP_POST, []() { startMotion3(); sendJsonOk("S3 da bat dau"); });
    server.on("/api/s3/stop", HTTP_POST, []() { stopMotion3(); sendJsonOk("S3 da dung"); });
    server.on("/api/s3/open", HTTP_POST, []() { startOpen3(); sendJsonOk("S3 dang mo"); });
    server.on("/api/s3/close", HTTP_POST, []() { startClose3(); sendJsonOk("S3 dang dong"); });
    server.on("/api/s3/test/forward", HTTP_POST, []() { testForward3(); sendJsonOk("S3 test thuan"); });
    server.on("/api/s3/test/reverse", HTTP_POST, []() { testReverse3(); sendJsonOk("S3 test nghich"); });

    // Servo 4 endpoints (Column 2 Upper Gate)
    server.on("/api/s4/start", HTTP_POST, []() { startMotion4(); sendJsonOk("S4 da bat dau"); });
    server.on("/api/s4/stop", HTTP_POST, []() { stopMotion4(); sendJsonOk("S4 da dung"); });
    server.on("/api/s4/open", HTTP_POST, []() { startOpen4(); sendJsonOk("S4 dang mo"); });
    server.on("/api/s4/close", HTTP_POST, []() { startClose4(); sendJsonOk("S4 dang dong"); });
    server.on("/api/s4/test/forward", HTTP_POST, []() { testForward4(); sendJsonOk("S4 test thuan"); });
    server.on("/api/s4/test/reverse", HTTP_POST, []() { testReverse4(); sendJsonOk("S4 test nghich"); });

    // FIFO Column Dispense endpoints
    server.on("/api/col1/dispense", HTTP_POST, []() { startDispenseCol1(); sendJsonOk("Cot 1 (Tao) dang nha to FIFO"); });
    server.on("/api/col2/dispense", HTTP_POST, []() { startDispenseCol2(); sendJsonOk("Cot 2 (Dua luoi) dang nha to FIFO"); });
    server.on("/api/dispense/1", HTTP_POST, []() { startDispenseCol1(); sendJsonOk("Cot 1 dang nha to FIFO"); });
    server.on("/api/dispense/2", HTTP_POST, []() { startDispenseCol2(); sendJsonOk("Cot 2 dang nha to FIFO"); });

    // Master / All endpoints
    server.on("/api/all/start", HTTP_POST, []() { startAll(); sendJsonOk("Tat ca 4 Servo da bat dau"); });
    server.on("/api/all/stop", HTTP_POST, []() { stopAll(); sendJsonOk("Tat ca Servo da dung"); });
    server.on("/api/all/open", HTTP_POST, []() { openAll(); sendJsonOk("Tat ca 4 Servo dang mo"); });
    server.on("/api/all/close", HTTP_POST, []() { closeAll(); sendJsonOk("Tat ca 4 Servo dang dong"); });

    // IR Sensor endpoints
    server.on("/api/ir/reset", HTTP_POST, []() {
        irObjectCount = 0;
        updateLcdQuad();
        sendJsonOk("Da reset bo dem to ve 0");
    });
    server.on("/api/ir/auto", HTTP_POST, []() {
        if (server.hasArg("mode")) {
            irAutoTriggerServo = server.arg("mode").toInt();
        } else {
            irAutoTriggerServo = (irAutoTriggerServo == 0) ? 1 : 0;
        }
        saveConfig();
        updateLcdQuad();
        sendJsonOk("Da cap nhat che do tu dong IR");
    });
    server.on("/api/ir/tx", HTTP_POST, []() {
        if (server.hasArg("enable")) {
            irTxEnabled = (server.arg("enable") == "1" || server.arg("enable") == "true");
        } else {
            irTxEnabled = !irTxEnabled;
        }
        digitalWrite(IR_TRANSMITTER_PIN, irTxEnabled ? HIGH : LOW);
        sendJsonOk("Da doi trang thai bo phat IR");
    });

    // Backwards compatibility endpoints
    server.on("/api/start", HTTP_POST, []() { startMotion1(); sendJsonOk("Da bat dau"); });
    server.on("/api/stop", HTTP_POST, []() { stopAll(); sendJsonOk("Da dung"); });
    server.on("/api/open", HTTP_POST, []() { startOpen1(); sendJsonOk("Dang mo"); });
    server.on("/api/close", HTTP_POST, []() { startClose1(); sendJsonOk("Dang dong"); });
    server.on("/api/test/forward", HTTP_POST, []() { testForward1(); sendJsonOk("Test thuan"); });
    server.on("/api/test/reverse", HTTP_POST, []() { testReverse1(); sendJsonOk("Test nghich"); });

    server.onNotFound([]() {
        sendJsonError(404, "Khong tim thay API hoac trang");
    });

    server.begin();
    Serial.println("[WEB] Server started with Quad-Servo (4 channels) endpoints");
}

// ============================================================
// 17. WIFI SETUP
// ============================================================

void setupWiFi() {
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.print("[WIFI] SoftAP started! SSID: ");
    Serial.print(AP_SSID);
    Serial.print(" | IP: ");
    Serial.println(WiFi.softAPIP());
}

// ============================================================
// 18. SERIAL CLI COMMAND INTERPRETER
// ============================================================

void handleSerial() {
    if (!Serial.available()) return;
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() == 0) return;

    if (cmd == "PING") {
        Serial.println("[RES] PONG");
    } else if (cmd == "STATUS" || cmd == "GET /api/status") {
        Serial.println("[RES] " + makeStatusJson());
    } else if (cmd == "CONFIG" || cmd == "GET /api/config") {
        Serial.println("[RES] " + makeConfigJson());

    // --- SERVO 1 COMMANDS ---
    } else if (cmd == "S1_START" || cmd == "START" || cmd == "POST /api/s1/start") {
        if (motionIsRunning(motionState1)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 1 dang chay\"}");
        } else {
            startMotion1();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 1 da bat dau\"}");
        }
    } else if (cmd == "S1_STOP" || cmd == "POST /api/s1/stop") {
        stopMotion1();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 1 da dung\"}");
    } else if (cmd == "S1_OPEN" || cmd == "OPEN" || cmd == "POST /api/s1/open") {
        if (motionIsRunning(motionState1)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 1 dang chay\"}");
        } else {
            startOpen1();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 1 dang mo\"}");
        }
    } else if (cmd == "S1_CLOSE" || cmd == "CLOSE" || cmd == "POST /api/s1/close") {
        if (motionIsRunning(motionState1)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 1 dang chay\"}");
        } else {
            startClose1();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 1 dang dong\"}");
        }
    } else if (cmd == "S1_TEST_FWD" || cmd == "TEST_FWD") {
        testForward1();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 1 quay thuan\"}");
    } else if (cmd == "S1_TEST_REV" || cmd == "TEST_REV") {
        testReverse1();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 1 quay nghich\"}");
    } else if (cmd.startsWith("S1_CALIB ") || cmd.startsWith("CALIB ")) {
        int val = (cmd.startsWith("S1_CALIB ")) ? cmd.substring(9).toInt() : cmd.substring(6).toInt();
        servo1Stop = val;
        servo1TestStopValue(val);
        Serial.printf("[RES] {\"ok\":true,\"channel\":1,\"value\":%d}\n", val);

    // --- SERVO 2 COMMANDS ---
    } else if (cmd == "S2_START" || cmd == "POST /api/s2/start") {
        if (motionIsRunning(motionState2)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 2 dang chay\"}");
        } else {
            startMotion2();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 2 da bat dau\"}");
        }
    } else if (cmd == "S2_STOP" || cmd == "POST /api/s2/stop") {
        stopMotion2();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 2 da dung\"}");
    } else if (cmd == "S2_OPEN" || cmd == "POST /api/s2/open") {
        if (motionIsRunning(motionState2)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 2 dang chay\"}");
        } else {
            startOpen2();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 2 dang mo\"}");
        }
    } else if (cmd == "S2_CLOSE" || cmd == "POST /api/s2/close") {
        if (motionIsRunning(motionState2)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 2 dang chay\"}");
        } else {
            startClose2();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 2 dang dong\"}");
        }
    } else if (cmd == "S2_TEST_FWD") {
        testForward2();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 2 quay thuan\"}");
    } else if (cmd == "S2_TEST_REV") {
        testReverse2();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 2 quay nghich\"}");
    } else if (cmd.startsWith("S2_CALIB ")) {
        int val = cmd.substring(9).toInt();
        servo2Stop = val;
        servo2TestStopValue(val);
        Serial.printf("[RES] {\"ok\":true,\"channel\":2,\"value\":%d}\n", val);

    // --- SERVO 3 COMMANDS ---
    } else if (cmd == "S3_START" || cmd == "POST /api/s3/start") {
        if (motionIsRunning(motionState3)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 3 dang chay\"}");
        } else {
            startMotion3();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 3 da bat dau\"}");
        }
    } else if (cmd == "S3_STOP" || cmd == "POST /api/s3/stop") {
        stopMotion3();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 3 da dung\"}");
    } else if (cmd == "S3_OPEN" || cmd == "POST /api/s3/open") {
        if (motionIsRunning(motionState3)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 3 dang chay\"}");
        } else {
            startOpen3();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 3 dang mo\"}");
        }
    } else if (cmd == "S3_CLOSE" || cmd == "POST /api/s3/close") {
        if (motionIsRunning(motionState3)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 3 dang chay\"}");
        } else {
            startClose3();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 3 dang dong\"}");
        }
    } else if (cmd == "S3_TEST_FWD") {
        testForward3();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 3 quay thuan\"}");
    } else if (cmd == "S3_TEST_REV") {
        testReverse3();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 3 quay nghich\"}");
    } else if (cmd.startsWith("S3_CALIB ")) {
        int val = cmd.substring(9).toInt();
        servo3Stop = val;
        servo3TestStopValue(val);
        Serial.printf("[RES] {\"ok\":true,\"channel\":3,\"value\":%d}\n", val);

    // --- SERVO 4 COMMANDS ---
    } else if (cmd == "S4_START" || cmd == "POST /api/s4/start") {
        if (motionIsRunning(motionState4)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 4 dang chay\"}");
        } else {
            startMotion4();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 4 da bat dau\"}");
        }
    } else if (cmd == "S4_STOP" || cmd == "POST /api/s4/stop") {
        stopMotion4();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 4 da dung\"}");
    } else if (cmd == "S4_OPEN" || cmd == "POST /api/s4/open") {
        if (motionIsRunning(motionState4)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 4 dang chay\"}");
        } else {
            startOpen4();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 4 dang mo\"}");
        }
    } else if (cmd == "S4_CLOSE" || cmd == "POST /api/s4/close") {
        if (motionIsRunning(motionState4)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Servo 4 dang chay\"}");
        } else {
            startClose4();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 4 dang dong\"}");
        }
    } else if (cmd == "S4_TEST_FWD") {
        testForward4();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 4 quay thuan\"}");
    } else if (cmd == "S4_TEST_REV") {
        testReverse4();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Servo 4 quay nghich\"}");
    } else if (cmd.startsWith("S4_CALIB ")) {
        int val = cmd.substring(9).toInt();
        servo4Stop = val;
        servo4TestStopValue(val);
        Serial.printf("[RES] {\"ok\":true,\"channel\":4,\"value\":%d}\n", val);

    // --- FIFO COLUMN DISPENSE COMMANDS ---
    } else if (cmd == "DISPENSE 1" || cmd == "COL1_DISPENSE" || cmd == "POST /api/col1/dispense" || cmd == "POST /api/dispense/1") {
        if (col1DispenseState != COL_IDLE || motionIsRunning(motionState1) || motionIsRunning(motionState2)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Cot 1 dang ban\"}");
        } else {
            startDispenseCol1();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Cot 1 dang nha to FIFO\"}");
        }
    } else if (cmd == "DISPENSE 2" || cmd == "COL2_DISPENSE" || cmd == "POST /api/col2/dispense" || cmd == "POST /api/dispense/2") {
        if (col2DispenseState != COL_IDLE || motionIsRunning(motionState3) || motionIsRunning(motionState4)) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Cot 2 dang ban\"}");
        } else {
            startDispenseCol2();
            Serial.println("[RES] {\"ok\":true,\"message\":\"Cot 2 dang nha to FIFO\"}");
        }

    // --- MASTER COMMANDS ---
    } else if (cmd == "ALL_START" || cmd == "POST /api/all/start") {
        startAll();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Tat ca 4 Servo da bat dau\"}");
    } else if (cmd == "ALL_STOP" || cmd == "STOP" || cmd == "POST /api/stop" || cmd == "POST /api/all/stop") {
        stopAll();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Tat ca Servo da dung\"}");
    } else if (cmd == "ALL_OPEN" || cmd == "POST /api/all/open") {
        openAll();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Tat ca 4 Servo dang mo\"}");
    } else if (cmd == "ALL_CLOSE" || cmd == "POST /api/all/close") {
        closeAll();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Tat ca 4 Servo dang dong\"}");

    // --- CONFIG COMMANDS ---
    } else if (cmd.startsWith("CONFIG_SET ") || cmd.startsWith("POST /api/config ")) {
        String params = cmd.substring(cmd.indexOf(' ') + 1);
        int pStop1 = servo1Stop, pFwd1 = servo1Forward, pRev1 = servo1Reverse, pCyc1 = cycles1;
        unsigned long pFwdMs1 = forwardMs1, pRevMs1 = reverseMs1, pPauseMs1 = pauseMs1;
        int pStop2 = servo2Stop, pFwd2 = servo2Forward, pRev2 = servo2Reverse, pCyc2 = cycles2;
        unsigned long pFwdMs2 = forwardMs2, pRevMs2 = reverseMs2, pPauseMs2 = pauseMs2;
        int pStop3 = servo3Stop, pFwd3 = servo3Forward, pRev3 = servo3Reverse, pCyc3 = cycles3;
        unsigned long pFwdMs3 = forwardMs3, pRevMs3 = reverseMs3, pPauseMs3 = pauseMs3;
        int pStop4 = servo4Stop, pFwd4 = servo4Forward, pRev4 = servo4Reverse, pCyc4 = cycles4;
        unsigned long pFwdMs4 = forwardMs4, pRevMs4 = reverseMs4, pPauseMs4 = pauseMs4;

        int idx = 0;
        while (idx < params.length()) {
            int eq = params.indexOf('=', idx);
            if (eq == -1) break;
            String key = params.substring(idx, eq);
            key.trim();
            int sp = params.indexOf(' ', eq + 1);
            String val = (sp == -1) ? params.substring(eq + 1) : params.substring(eq + 1, sp);
            val.trim();

            // S1
            if (key == "stop" || key == "stop1") pStop1 = val.toInt();
            else if (key == "forward" || key == "forward1") pFwd1 = val.toInt();
            else if (key == "reverse" || key == "reverse1") pRev1 = val.toInt();
            else if (key == "forwardMs" || key == "fwdMs" || key == "fwdMs1") pFwdMs1 = strtoul(val.c_str(), NULL, 10);
            else if (key == "reverseMs" || key == "revMs" || key == "revMs1") pRevMs1 = strtoul(val.c_str(), NULL, 10);
            else if (key == "pauseMs" || key == "pauseMs1") pPauseMs1 = strtoul(val.c_str(), NULL, 10);
            else if (key == "cycles" || key == "cycles1") pCyc1 = val.toInt();
            // S2
            else if (key == "stop2") pStop2 = val.toInt();
            else if (key == "forward2") pFwd2 = val.toInt();
            else if (key == "reverse2") pRev2 = val.toInt();
            else if (key == "forwardMs2" || key == "fwdMs2") pFwdMs2 = strtoul(val.c_str(), NULL, 10);
            else if (key == "reverseMs2" || key == "revMs2") pRevMs2 = strtoul(val.c_str(), NULL, 10);
            else if (key == "pauseMs2") pPauseMs2 = strtoul(val.c_str(), NULL, 10);
            else if (key == "cycles2") pCyc2 = val.toInt();
            // S3
            else if (key == "stop3") pStop3 = val.toInt();
            else if (key == "forward3") pFwd3 = val.toInt();
            else if (key == "reverse3") pRev3 = val.toInt();
            else if (key == "forwardMs3" || key == "fwdMs3") pFwdMs3 = strtoul(val.c_str(), NULL, 10);
            else if (key == "reverseMs3" || key == "revMs3") pRevMs3 = strtoul(val.c_str(), NULL, 10);
            else if (key == "pauseMs3") pPauseMs3 = strtoul(val.c_str(), NULL, 10);
            else if (key == "cycles3") pCyc3 = val.toInt();
            // S4
            else if (key == "stop4") pStop4 = val.toInt();
            else if (key == "forward4") pFwd4 = val.toInt();
            else if (key == "reverse4") pRev4 = val.toInt();
            else if (key == "forwardMs4" || key == "fwdMs4") pFwdMs4 = strtoul(val.c_str(), NULL, 10);
            else if (key == "reverseMs4" || key == "revMs4") pRevMs4 = strtoul(val.c_str(), NULL, 10);
            else if (key == "pauseMs4") pPauseMs4 = strtoul(val.c_str(), NULL, 10);
            else if (key == "cycles4") pCyc4 = val.toInt();

            if (sp == -1) break;
            idx = sp + 1;
        }

        if (motionIsRunning()) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Khong the doi cau hinh khi Servo dang chay\"}");
        } else {
            servo1Stop = constrain(pStop1, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            servo1Forward = constrain(pFwd1, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            servo1Reverse = constrain(pRev1, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            forwardMs1 = constrain(pFwdMs1, MOTION_TIME_MIN, MOTION_TIME_MAX);
            reverseMs1 = constrain(pRevMs1, MOTION_TIME_MIN, MOTION_TIME_MAX);
            pauseMs1 = constrain(pPauseMs1, 0UL, MOTION_TIME_MAX);
            cycles1 = constrain(pCyc1, CYCLES_MIN, CYCLES_MAX);

            servo2Stop = constrain(pStop2, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            servo2Forward = constrain(pFwd2, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            servo2Reverse = constrain(pRev2, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            forwardMs2 = constrain(pFwdMs2, MOTION_TIME_MIN, MOTION_TIME_MAX);
            reverseMs2 = constrain(pRevMs2, MOTION_TIME_MIN, MOTION_TIME_MAX);
            pauseMs2 = constrain(pPauseMs2, 0UL, MOTION_TIME_MAX);
            cycles2 = constrain(pCyc2, CYCLES_MIN, CYCLES_MAX);

            servo3Stop = constrain(pStop3, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            servo3Forward = constrain(pFwd3, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            servo3Reverse = constrain(pRev3, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            forwardMs3 = constrain(pFwdMs3, MOTION_TIME_MIN, MOTION_TIME_MAX);
            reverseMs3 = constrain(pRevMs3, MOTION_TIME_MIN, MOTION_TIME_MAX);
            pauseMs3 = constrain(pPauseMs3, 0UL, MOTION_TIME_MAX);
            cycles3 = constrain(pCyc3, CYCLES_MIN, CYCLES_MAX);

            servo4Stop = constrain(pStop4, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            servo4Forward = constrain(pFwd4, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            servo4Reverse = constrain(pRev4, SERVO_VALUE_MIN, SERVO_VALUE_MAX);
            forwardMs4 = constrain(pFwdMs4, MOTION_TIME_MIN, MOTION_TIME_MAX);
            reverseMs4 = constrain(pRevMs4, MOTION_TIME_MIN, MOTION_TIME_MAX);
            pauseMs4 = constrain(pPauseMs4, 0UL, MOTION_TIME_MAX);
            cycles4 = constrain(pCyc4, CYCLES_MIN, CYCLES_MAX);

            saveConfig();
            servo1StopNow();
            servo2StopNow();
            servo3StopNow();
            servo4StopNow();
            Serial.println("[RES] " + makeConfigJson());
        }
    } else if (cmd == "RESET" || cmd == "POST /api/config/reset") {
        if (motionIsRunning()) {
            Serial.println("[RES] {\"ok\":false,\"error\":\"Khong the khoi phuc khi Servo dang chay\"}");
        } else {
            stopAll();
            setDefaultConfig();
            saveConfig();
            servo1StopNow();
            servo2StopNow();
            servo3StopNow();
            servo4StopNow();
            Serial.println("[RES] " + makeConfigJson());
        }

    // --- IR SENSOR COMMANDS ---
    } else if (cmd == "IR_RESET" || cmd == "POST /api/ir/reset") {
        irObjectCount = 0;
        updateLcdQuad();
        Serial.println("[RES] {\"ok\":true,\"message\":\"Da reset bo dem to ve 0\"}");
    } else if (cmd.startsWith("IR_AUTO ") || cmd.startsWith("IR_AUTO_SET ")) {
        int m = cmd.substring(cmd.indexOf(' ') + 1).toInt();
        irAutoTriggerServo = m;
        saveConfig();
        updateLcdQuad();
        Serial.printf("[RES] {\"ok\":true,\"autoTrigger\":%d}\n", m);
    } else if (cmd == "IR_TX_ON") {
        irTxEnabled = true;
        digitalWrite(IR_TRANSMITTER_PIN, HIGH);
        Serial.println("[RES] {\"ok\":true,\"tx\":true}");
    } else if (cmd == "IR_TX_OFF") {
        irTxEnabled = false;
        digitalWrite(IR_TRANSMITTER_PIN, LOW);
        Serial.println("[RES] {\"ok\":true,\"tx\":false}");
    } else if (cmd == "IR_TRIGGER" || cmd == "POST /api/ir/simulate") {
        irObjectCount++;
        irDetected = true;
        irBlockDurationMs = 350;
        irLastDetectionMs = millis();
        irBlockStartMs = millis();
        Serial.printf("[IR] BOWL DETECTED! Count = %u (SIMULATED)\n", irObjectCount);
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
        Serial.printf("[RES] {\"ok\":true,\"count\":%u,\"detected\":true}\n", irObjectCount);
    } else {
        Serial.println("[RES] {\"ok\":false,\"error\":\"Unknown command\"}");
    }
}

// ============================================================
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
