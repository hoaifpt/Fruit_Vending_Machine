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
        bool maintenanceClear = false;
        bool maintenanceEmptyColumn = false;
        char maintenanceOperation[20] = {};
        char columnCode = '\0';
    };

    explicit DispenseController(ServoDriver &servoDriver);

    void begin();
    void update();

    // Starts one full cycle; false when not IDLE (busy, testing or FAULT).
    bool start(const char *commandId, char columnCode = 'A');
    bool startMaintenanceRemoveItem(const char *commandId, char columnCode);
    bool startMaintenanceEmptyColumn(const char *commandId, char columnCode);
    bool startMaintenanceOpenRefill(const char *commandId, char columnCode);
    bool startMaintenanceCloseRefill(const char *commandId, char columnCode);
    // Stops every servo. A cycle in progress ends ABORTED and the controller enters FAULT.
    void abort();
    // Operator confirmed the gates are closed after a FAULT.
    bool reset();
    // Turns one servo with a raw pulse for durationMs (calibration); when IDLE or FAULT.
    bool startServoTest(uint8_t servoNumber, int pulseUs, unsigned long durationMs);
    // Opens or closes one gate with the configured pulse and SERVO_OPEN_TIME_MS / SERVO_CLOSE_TIME_MS; when IDLE or FAULT.
    bool startGateMove(Gate gate, bool open);

    // Returns the finished cycle once, then clears it.
    bool takeResult(Result &out);

    DispenseState state() const { return current; }
    const char *stateName() const;
    const char *activeCommandId() const { return commandId; }
    char dispenseColumnCode() const { return dispenseColumn; }
    bool cycleActive() const;
    bool maintenanceClearActive() const;
    bool maintenanceOperationActive(const char *operation) const;
    bool maintenanceAlreadyCompleted(const char *id, char columnCode, const char *operation) const;
    char maintenanceColumnCode() const { return maintenanceColumn; }
    const char *maintenanceOperationName() const { return maintenanceOperation; }
    DispenseOutcome lastMaintenanceOutcomeValue() const { return lastMaintenanceOutcome; }

private:
    ServoDriver &servoDriver;
    DispenseState current = DispenseState::IDLE;
    unsigned long phaseStartedAt = 0;
    unsigned long phaseDurationMs = 0;
    char commandId[COMMAND_ID_SIZE] = {};
    bool resultReady = false;
    bool faultAfterTest = false;
    bool maintenanceClear = false;
    bool maintenanceEmptyColumn = false;
    char maintenanceOperation[20] = {};
    char dispenseColumn = '\0';
    uint8_t dispenseLowerServos = 0;
    uint8_t dispenseUpperServos = 0;
    char maintenanceColumn = '\0';
    char lastMaintenanceColumn = '\0';
    uint8_t maintenanceLowerServos = 0;
    uint8_t maintenanceUpperServos = 0;
    char lastMaintenanceCommandId[COMMAND_ID_SIZE] = {};
    DispenseOutcome lastMaintenanceOutcome = DispenseOutcome::ABORTED;
    bool lastMaintenanceEmptyColumn = false;
    char lastMaintenanceOperation[20] = {};
    Result result = {};

    void enter(DispenseState next, unsigned long durationMs);
    bool beginManualMove(unsigned long durationMs);
    void finish(DispenseOutcome outcome);
    bool startMaintenance(const char *id, char columnCode, bool emptyColumn);
    bool startMaintenanceRefill(const char *id, char columnCode, bool open);
    bool selectColumn(char columnCode, uint8_t &lowerServos, uint8_t &upperServos) const;
};
