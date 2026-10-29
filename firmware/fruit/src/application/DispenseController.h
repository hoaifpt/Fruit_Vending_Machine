#pragma once

#include <Arduino.h>

#include "DispenseState.h"
#include "hal/ServoDriver.h"

// Non-blocking dispense sequencer. Servos only move because of an explicit command (start or servo test), never because of a sensor.
class DispenseController
{
public:
    static constexpr size_t COMMAND_ID_SIZE = 40;

    struct Result
    {
        char commandId[COMMAND_ID_SIZE];
        DispenseOutcome outcome;
    };

    explicit DispenseController(ServoDriver &servoDriver);

    void begin();
    void update();

    // Starts one full cycle for column (1 or 2); false when not IDLE (busy, testing or FAULT).
    bool start(const char *commandId, uint8_t column = 1);
    // Stops every servo. A cycle in progress ends ABORTED and the controller enters FAULT.
    void abort();
    // Operator confirmed the gates are closed after a FAULT.
    bool reset();
    // Turns one servo with a raw pulse for durationMs (calibration); when IDLE or FAULT.
    bool startServoTest(uint8_t servoNumber, int pulseUs, unsigned long durationMs);
    // Opens or closes one gate with the configured pulse and SERVO_OPEN_TIME_MS / SERVO_CLOSE_TIME_MS; when IDLE or FAULT.
    bool startGateMove(Gate gate, bool open, uint8_t column = 1);

    // Returns the finished cycle once, then clears it.
    bool takeResult(Result &out);

    DispenseState state() const { return current; }
    const char *stateName() const;
    const char *activeCommandId() const { return commandId; }
    uint8_t column() const { return activeColumn; }
    bool cycleActive() const;

private:
    ServoDriver &servoDriver;
    DispenseState current = DispenseState::IDLE;
    unsigned long phaseStartedAt = 0;
    unsigned long phaseDurationMs = 0;
    char commandId[COMMAND_ID_SIZE] = {};
    uint8_t activeColumn = 1;
    uint8_t activeLowerMask = 0;
    uint8_t activeUpperMask = 0;
    bool resultReady = false;
    bool faultAfterTest = false;
    Result result = {};

    void enter(DispenseState next, unsigned long durationMs);
    bool beginManualMove(unsigned long durationMs);
    void finish(DispenseOutcome outcome);
};
