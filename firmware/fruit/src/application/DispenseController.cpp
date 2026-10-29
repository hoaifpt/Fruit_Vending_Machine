#include "DispenseController.h"

#include <cstring>

#include "app_config.h"

DispenseController::DispenseController(ServoDriver &servoDriver)
    : servoDriver(servoDriver) {}

void DispenseController::begin()
{
    servoDriver.stopAll();
    current = DispenseState::IDLE;
    commandId[0] = '\0';
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
    return current == DispenseState::LOCK_UPPER ||
           current == DispenseState::OPENING_LOWER || current == DispenseState::HOLD_LOWER ||
           current == DispenseState::CLOSING_LOWER || current == DispenseState::PAUSE_BETWEEN_GATES ||
           current == DispenseState::OPENING_UPPER || current == DispenseState::HOLD_UPPER ||
           current == DispenseState::CLOSING_UPPER;
}

bool DispenseController::start(const char *id, uint8_t column)
{
    if (current != DispenseState::IDLE)
    {
        return false;
    }
    strncpy(commandId, id, COMMAND_ID_SIZE - 1);
    commandId[COMMAND_ID_SIZE - 1] = '\0';
    activeColumn = (column == 2) ? 2 : 1;
    activeLowerMask = (activeColumn == 2) ? AppConfig::LOWER_GATE_COL2 : AppConfig::LOWER_GATE_COL1;
    activeUpperMask = (activeColumn == 2) ? AppConfig::UPPER_GATE_COL2 : AppConfig::UPPER_GATE_COL1;

    // Step 1: Ensure upper gate is closed and clamping upper bowls tightly before lower opens
    servoDriver.closeGate(activeUpperMask);
    enter(DispenseState::LOCK_UPPER, AppConfig::LOCK_UPPER_TIME_MS);
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
    case DispenseState::LOCK_UPPER:
        // Upper gate locked; now open lower gate to dispense the current bowl
        servoDriver.stopAll();
        servoDriver.openGate(activeLowerMask);
        enter(DispenseState::OPENING_LOWER, AppConfig::SERVO_OPEN_TIME_MS);
        break;
    case DispenseState::OPENING_LOWER:
        servoDriver.stopAll();
        enter(DispenseState::HOLD_LOWER, AppConfig::DISPENSE_HOLD_MS);
        break;
    case DispenseState::HOLD_LOWER:
        // Bowl fell out; close lower gate so it can act as the bottom support for the next bowl
        servoDriver.closeGate(activeLowerMask);
        enter(DispenseState::CLOSING_LOWER, AppConfig::SERVO_CLOSE_TIME_MS);
        break;
    case DispenseState::CLOSING_LOWER:
        // Lower gate is now fully closed. Stop all servos and PAUSE for ~5 seconds
        // between the dispense mechanism and refill mechanism as requested.
        servoDriver.stopAll();
        enter(DispenseState::PAUSE_BETWEEN_GATES, AppConfig::GATE_TRANSITION_PAUSE_MS);
        break;
    case DispenseState::PAUSE_BETWEEN_GATES:
        // 5s pause completed. Now open upper gate so next bowl in FIFO stack drops down to the lower gate
        servoDriver.openGate(activeUpperMask);
        enter(DispenseState::OPENING_UPPER, AppConfig::SERVO_OPEN_TIME_MS);
        break;
    case DispenseState::OPENING_UPPER:
        servoDriver.stopAll();
        enter(DispenseState::HOLD_UPPER, AppConfig::REFILL_HOLD_MS);
        break;
    case DispenseState::HOLD_UPPER:
        // Next bowl has settled on lower gate; close upper gate to clamp remaining stack
        servoDriver.closeGate(activeUpperMask);
        enter(DispenseState::CLOSING_UPPER, AppConfig::SERVO_CLOSE_TIME_MS);
        break;
    case DispenseState::CLOSING_UPPER:
        // Cycle completed successfully
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

bool DispenseController::startGateMove(Gate gate, bool open, uint8_t column)
{
    if (current != DispenseState::IDLE && current != DispenseState::FAULT)
    {
        return false;
    }
    const uint8_t col = (column == 2) ? 2 : 1;
    const uint8_t lowerMask = (col == 2) ? AppConfig::LOWER_GATE_COL2 : AppConfig::LOWER_GATE_COL1;
    const uint8_t upperMask = (col == 2) ? AppConfig::UPPER_GATE_COL2 : AppConfig::UPPER_GATE_COL1;
    const uint8_t servos = (gate == Gate::LOWER) ? lowerMask : upperMask;

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
    resultReady = true;
    commandId[0] = '\0';
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
    case DispenseState::LOCK_UPPER: return "LOCK_UPPER";
    case DispenseState::OPENING_LOWER: return "OPENING_LOWER";
    case DispenseState::HOLD_LOWER: return "HOLD_LOWER";
    case DispenseState::CLOSING_LOWER: return "CLOSING_LOWER";
    case DispenseState::PAUSE_BETWEEN_GATES: return "PAUSE_BETWEEN_GATES";
    case DispenseState::OPENING_UPPER: return "OPENING_UPPER";
    case DispenseState::HOLD_UPPER: return "HOLD_UPPER";
    case DispenseState::CLOSING_UPPER: return "CLOSING_UPPER";
    case DispenseState::MANUAL_MOVE: return "MANUAL_MOVE";
    case DispenseState::FAULT: return "FAULT";
    }
    return "UNKNOWN";
}
