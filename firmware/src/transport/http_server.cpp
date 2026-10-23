#include "core/runtime_api.hpp"

// 14. WEB UI HEADER
// ============================================================
#include "transport/web_ui.h"

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
