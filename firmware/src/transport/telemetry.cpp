#include "core/runtime_api.hpp"

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
