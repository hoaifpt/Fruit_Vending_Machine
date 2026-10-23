#include "core/runtime_api.hpp"

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
