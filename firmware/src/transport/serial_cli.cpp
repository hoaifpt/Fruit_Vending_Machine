#include "core/runtime_api.hpp"

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
