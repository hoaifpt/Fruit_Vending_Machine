#include "DispenseController.h"

#include <cctype>
#include <cstring>

#include "app_config.h"

DispenseController::DispenseController(ServoDriver &servoDriver)
    : servoDriver(servoDriver) {}

void DispenseController::begin()
{
    servoDriver.stopAll();
    current = DispenseState::IDLE;
    commandId[0] = '\0';
    lastMaintenanceCommandId[0] = '\0';
    lastMaintenanceColumn = '\0';
    lastMaintenanceOperation[0] = '\0';
    maintenanceColumn = '\0';
    dispenseColumn = '\0';
    maintenanceClear = false;
    maintenanceEmptyColumn = false;
    maintenanceOperation[0] = '\0';
    lastMaintenanceEmptyColumn = false;
    resultReady = false;
}

void DispenseController::enter(DispenseState next, unsigned long durationMs)
{
    current = next;
    phaseStartedAt = millis();
    phaseDurationMs = durationMs;
}

bool DispenseController::cycleActive() const
{
    return current == DispenseState::OPENING_LOWER || current == DispenseState::HOLD_LOWER ||
           current == DispenseState::CLOSING_LOWER || current == DispenseState::OPENING_UPPER ||
           current == DispenseState::HOLD_UPPER || current == DispenseState::CLOSING_UPPER ||
           current == DispenseState::CLEARING_COLUMN || current == DispenseState::HOLDING_COLUMN ||
           current == DispenseState::CLOSING_COLUMN || current == DispenseState::OPENING_COLUMN_UPPER ||
           current == DispenseState::HOLDING_COLUMN_UPPER || current == DispenseState::CLOSING_COLUMN_UPPER ||
           current == DispenseState::OPENING_REFILL_UPPER || current == DispenseState::CLOSING_REFILL_UPPER;
}

bool DispenseController::maintenanceClearActive() const
{
    return current == DispenseState::CLEARING_COLUMN || current == DispenseState::HOLDING_COLUMN ||
           current == DispenseState::CLOSING_COLUMN || current == DispenseState::OPENING_COLUMN_UPPER ||
           current == DispenseState::HOLDING_COLUMN_UPPER || current == DispenseState::CLOSING_COLUMN_UPPER ||
           current == DispenseState::OPENING_REFILL_UPPER || current == DispenseState::CLOSING_REFILL_UPPER;
}

bool DispenseController::maintenanceOperationActive(const char *operation) const
{
    return maintenanceClear && operation != nullptr &&
           strcmp(maintenanceOperation, operation) == 0;
}

bool DispenseController::maintenanceAlreadyCompleted(const char *id, char columnCode, const char *operation) const
{
    return id != nullptr && lastMaintenanceCommandId[0] != '\0' &&
           strcmp(lastMaintenanceCommandId, id) == 0 && lastMaintenanceColumn == columnCode &&
           operation != nullptr && strcmp(lastMaintenanceOperation, operation) == 0;
}

bool DispenseController::start(const char *id, char columnCode)
{
    if (current != DispenseState::IDLE || id == nullptr ||
        !selectColumn(columnCode, dispenseLowerServos, dispenseUpperServos))
    {
        return false;
    }
    strncpy(commandId, id, COMMAND_ID_SIZE - 1);
    commandId[COMMAND_ID_SIZE - 1] = '\0';
    maintenanceClear = false;
    maintenanceEmptyColumn = false;
    maintenanceOperation[0] = '\0';
    dispenseColumn = columnCode;
    servoDriver.openGate(dispenseLowerServos);
    enter(DispenseState::OPENING_LOWER, AppConfig::SERVO_OPEN_TIME_MS);
    return true;
}

bool DispenseController::startMaintenanceRemoveItem(const char *id, char columnCode)
{
    return startMaintenance(id, columnCode, false);
}

bool DispenseController::startMaintenanceEmptyColumn(const char *id, char columnCode)
{
    return startMaintenance(id, columnCode, true);
}

bool DispenseController::startMaintenanceOpenRefill(const char *id, char columnCode)
{
    return startMaintenanceRefill(id, columnCode, true);
}

bool DispenseController::startMaintenanceCloseRefill(const char *id, char columnCode)
{
    return startMaintenanceRefill(id, columnCode, false);
}

bool DispenseController::startMaintenance(const char *id, char columnCode, bool emptyColumn)
{
    if (current != DispenseState::IDLE || id == nullptr)
    {
        return false;
    }
    const size_t length = strlen(id);
    if (length == 0 || length >= COMMAND_ID_SIZE)
    {
        return false;
    }
    for (size_t i = 0; i < length; i++)
    {
        if (!isalnum(static_cast<unsigned char>(id[i])) && id[i] != '-' && id[i] != '_')
        {
            return false;
        }
    }
    if (!selectColumn(columnCode, maintenanceLowerServos, maintenanceUpperServos))
    {
        return false;
    }
    strncpy(commandId, id, COMMAND_ID_SIZE - 1);
    commandId[COMMAND_ID_SIZE - 1] = '\0';
    maintenanceClear = true;
    maintenanceEmptyColumn = emptyColumn;
    strncpy(maintenanceOperation, emptyColumn ? "EMPTY_COLUMN" : "REMOVE_ITEM",
            sizeof(maintenanceOperation) - 1);
    maintenanceOperation[sizeof(maintenanceOperation) - 1] = '\0';
    maintenanceColumn = columnCode;
    servoDriver.openGate(maintenanceLowerServos);
    enter(DispenseState::CLEARING_COLUMN, AppConfig::SERVO_OPEN_TIME_MS);
    return true;
}

bool DispenseController::startMaintenanceRefill(const char *id, char columnCode, bool open)
{
    if (current != DispenseState::IDLE || id == nullptr)
    {
        return false;
    }
    const size_t length = strlen(id);
    if (length == 0 || length >= COMMAND_ID_SIZE)
    {
        return false;
    }
    for (size_t i = 0; i < length; i++)
    {
        if (!isalnum(static_cast<unsigned char>(id[i])) && id[i] != '-' && id[i] != '_')
        {
            return false;
        }
    }
    if (!selectColumn(columnCode, maintenanceLowerServos, maintenanceUpperServos))
    {
        return false;
    }

    strncpy(commandId, id, COMMAND_ID_SIZE - 1);
    commandId[COMMAND_ID_SIZE - 1] = '\0';
    maintenanceClear = true;
    maintenanceEmptyColumn = false;
    strncpy(maintenanceOperation, open ? "OPEN_REFILL" : "CLOSE_REFILL",
            sizeof(maintenanceOperation) - 1);
    maintenanceOperation[sizeof(maintenanceOperation) - 1] = '\0';
    maintenanceColumn = columnCode;
    if (open)
    {
        servoDriver.openGate(maintenanceUpperServos);
        enter(DispenseState::OPENING_REFILL_UPPER, AppConfig::SERVO_OPEN_TIME_MS);
    }
    else
    {
        servoDriver.closeGate(maintenanceUpperServos);
        enter(DispenseState::CLOSING_REFILL_UPPER, AppConfig::SERVO_CLOSE_TIME_MS);
    }
    return true;
}

void DispenseController::update()
{
    if (current == DispenseState::IDLE || current == DispenseState::FAULT)
    {
        return;
    }
    if (millis() - phaseStartedAt < phaseDurationMs)
    {
        return;
    }

    switch (current)
    {
    case DispenseState::OPENING_LOWER:
        servoDriver.stopAll();
        enter(DispenseState::HOLD_LOWER, AppConfig::DISPENSE_HOLD_MS);
        break;
    case DispenseState::HOLD_LOWER:
        servoDriver.closeGate(dispenseLowerServos);
        enter(DispenseState::CLOSING_LOWER, AppConfig::SERVO_CLOSE_TIME_MS);
        break;
    case DispenseState::CLOSING_LOWER:
        // The lower gate is fully closed before the upper one opens, so the next bowl cannot fall straight through.
        servoDriver.stopAll();
        servoDriver.openGate(dispenseUpperServos);
        enter(DispenseState::OPENING_UPPER, AppConfig::SERVO_OPEN_TIME_MS);
        break;
    case DispenseState::OPENING_UPPER:
        servoDriver.stopAll();
        enter(DispenseState::HOLD_UPPER, AppConfig::REFILL_HOLD_MS);
        break;
    case DispenseState::HOLD_UPPER:
        servoDriver.closeGate(dispenseUpperServos);
        enter(DispenseState::CLOSING_UPPER, AppConfig::SERVO_CLOSE_TIME_MS);
        break;
    case DispenseState::CLOSING_UPPER:
        servoDriver.stopAll();
        finish(DispenseOutcome::OK);
        current = DispenseState::IDLE;
        break;
    case DispenseState::CLEARING_COLUMN:
        servoDriver.stopAll();
        enter(DispenseState::HOLDING_COLUMN,
              maintenanceEmptyColumn ? AppConfig::MAINTENANCE_EMPTY_COLUMN_HOLD_MS
                                     : AppConfig::MAINTENANCE_REMOVE_ITEM_HOLD_MS);
        break;
    case DispenseState::HOLDING_COLUMN:
        servoDriver.closeGate(maintenanceLowerServos);
        enter(DispenseState::CLOSING_COLUMN, AppConfig::SERVO_CLOSE_TIME_MS);
        break;
    case DispenseState::CLOSING_COLUMN:
        servoDriver.stopAll();
        if (maintenanceEmptyColumn)
        {
            finish(DispenseOutcome::OK);
            current = DispenseState::IDLE;
        }
        else
        {
            servoDriver.openGate(maintenanceUpperServos);
            enter(DispenseState::OPENING_COLUMN_UPPER, AppConfig::SERVO_OPEN_TIME_MS);
        }
        break;
    case DispenseState::OPENING_COLUMN_UPPER:
        servoDriver.stopAll();
        enter(DispenseState::HOLDING_COLUMN_UPPER, AppConfig::REFILL_HOLD_MS);
        break;
    case DispenseState::HOLDING_COLUMN_UPPER:
        servoDriver.closeGate(maintenanceUpperServos);
        enter(DispenseState::CLOSING_COLUMN_UPPER, AppConfig::SERVO_CLOSE_TIME_MS);
        break;
    case DispenseState::CLOSING_COLUMN_UPPER:
        servoDriver.stopAll();
        finish(DispenseOutcome::OK);
        current = DispenseState::IDLE;
        break;
    case DispenseState::OPENING_REFILL_UPPER:
    case DispenseState::CLOSING_REFILL_UPPER:
        servoDriver.stopAll();
        finish(DispenseOutcome::OK);
        current = DispenseState::IDLE;
        break;
    case DispenseState::MANUAL_MOVE:
        servoDriver.stopAll();
        current = faultAfterTest ? DispenseState::FAULT : DispenseState::IDLE;
        faultAfterTest = false;
        break;
    default:
        break;
    }
}

void DispenseController::abort()
{
    servoDriver.stopAll();
    if (cycleActive())
    {
        finish(DispenseOutcome::ABORTED);
        current = DispenseState::FAULT;
    }
    else if (current == DispenseState::MANUAL_MOVE)
    {
        current = faultAfterTest ? DispenseState::FAULT : DispenseState::IDLE;
        faultAfterTest = false;
    }
}

bool DispenseController::reset()
{
    if (current != DispenseState::FAULT)
    {
        return false;
    }
    servoDriver.stopAll();
    current = DispenseState::IDLE;
    return true;
}

bool DispenseController::beginManualMove(unsigned long durationMs)
{
    // Manual moves are also allowed in FAULT (to drive a gate back); the controller stays faulted until RESET.
    faultAfterTest = current == DispenseState::FAULT;
    enter(DispenseState::MANUAL_MOVE, durationMs);
    return true;
}

bool DispenseController::startServoTest(uint8_t servoNumber, int pulseUs, unsigned long durationMs)
{
    if ((current != DispenseState::IDLE && current != DispenseState::FAULT) || durationMs == 0 ||
        durationMs > AppConfig::SERVO_TEST_MAX_MS)
    {
        return false;
    }
    if (!servoDriver.writePulse(servoNumber, pulseUs))
    {
        return false;
    }
    return beginManualMove(durationMs);
}

bool DispenseController::startGateMove(Gate gate, bool open)
{
    if (current != DispenseState::IDLE && current != DispenseState::FAULT)
    {
        return false;
    }
    const uint8_t servos = gate == Gate::LOWER ? AppConfig::LOWER_GATE_SERVOS : AppConfig::UPPER_GATE_SERVOS;
    if (open)
        servoDriver.openGate(servos);
    else
        servoDriver.closeGate(servos);
    return beginManualMove(open ? AppConfig::SERVO_OPEN_TIME_MS : AppConfig::SERVO_CLOSE_TIME_MS);
}

void DispenseController::finish(DispenseOutcome outcome)
{
    strncpy(result.commandId, commandId, COMMAND_ID_SIZE);
    result.outcome = outcome;
    result.maintenanceClear = maintenanceClear;
    result.maintenanceEmptyColumn = maintenanceEmptyColumn;
    strncpy(result.maintenanceOperation, maintenanceOperation,
            sizeof(result.maintenanceOperation) - 1);
    result.maintenanceOperation[sizeof(result.maintenanceOperation) - 1] = '\0';
    result.columnCode = maintenanceClear ? maintenanceColumn : dispenseColumn;
    if (maintenanceClear)
    {
        strncpy(lastMaintenanceCommandId, commandId, COMMAND_ID_SIZE - 1);
        lastMaintenanceCommandId[COMMAND_ID_SIZE - 1] = '\0';
        lastMaintenanceOutcome = outcome;
        lastMaintenanceColumn = maintenanceColumn;
        lastMaintenanceEmptyColumn = maintenanceEmptyColumn;
        strncpy(lastMaintenanceOperation, maintenanceOperation,
                sizeof(lastMaintenanceOperation) - 1);
        lastMaintenanceOperation[sizeof(lastMaintenanceOperation) - 1] = '\0';
    }
    resultReady = true;
    commandId[0] = '\0';
    maintenanceClear = false;
    maintenanceEmptyColumn = false;
    maintenanceOperation[0] = '\0';
    dispenseColumn = '\0';
}

bool DispenseController::selectColumn(char columnCode, uint8_t &lowerServos, uint8_t &upperServos) const
{
    switch (columnCode)
    {
    case 'A':
        lowerServos = AppConfig::COLUMN_A_LOWER_SERVOS;
        upperServos = AppConfig::COLUMN_A_UPPER_SERVOS;
        return true;
    case 'B':
        lowerServos = AppConfig::COLUMN_B_LOWER_SERVOS;
        upperServos = AppConfig::COLUMN_B_UPPER_SERVOS;
        return true;
    default:
        return false;
    }
}

bool DispenseController::takeResult(Result &out)
{
    if (!resultReady)
    {
        return false;
    }
    out = result;
    resultReady = false;
    return true;
}

const char *DispenseController::stateName() const
{
    switch (current)
    {
    case DispenseState::IDLE: return "IDLE";
    case DispenseState::OPENING_LOWER: return "OPENING_LOWER";
    case DispenseState::HOLD_LOWER: return "HOLD_LOWER";
    case DispenseState::CLOSING_LOWER: return "CLOSING_LOWER";
    case DispenseState::OPENING_UPPER: return "OPENING_UPPER";
    case DispenseState::HOLD_UPPER: return "HOLD_UPPER";
    case DispenseState::CLOSING_UPPER: return "CLOSING_UPPER";
    case DispenseState::CLEARING_COLUMN: return "CLEARING_COLUMN";
    case DispenseState::HOLDING_COLUMN: return "HOLDING_COLUMN";
    case DispenseState::CLOSING_COLUMN: return "CLOSING_COLUMN";
    case DispenseState::OPENING_COLUMN_UPPER: return "OPENING_COLUMN_UPPER";
    case DispenseState::HOLDING_COLUMN_UPPER: return "HOLDING_COLUMN_UPPER";
    case DispenseState::CLOSING_COLUMN_UPPER: return "CLOSING_COLUMN_UPPER";
    case DispenseState::OPENING_REFILL_UPPER: return "OPENING_REFILL_UPPER";
    case DispenseState::CLOSING_REFILL_UPPER: return "CLOSING_REFILL_UPPER";
    case DispenseState::MANUAL_MOVE: return "MANUAL_MOVE";
    case DispenseState::FAULT: return "FAULT";
    }
    return "UNKNOWN";
}
