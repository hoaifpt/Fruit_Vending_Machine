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
    return current == DispenseState::OPENING_LOWER || current == DispenseState::HOLD_LOWER ||
           current == DispenseState::CLOSING_LOWER || current == DispenseState::OPENING_UPPER ||
           current == DispenseState::HOLD_UPPER || current == DispenseState::CLOSING_UPPER;
}

bool DispenseController::start(const char *id)
{
    if (current != DispenseState::IDLE)
    {
        return false;
    }
    strncpy(commandId, id, COMMAND_ID_SIZE - 1);
    commandId[COMMAND_ID_SIZE - 1] = '\0';
    servoDriver.openGate(AppConfig::LOWER_GATE_SERVOS);
    enter(DispenseState::OPENING_LOWER, AppConfig::SERVO_MOVE_TIME_MS);
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
        servoDriver.closeGate(AppConfig::LOWER_GATE_SERVOS);
        enter(DispenseState::CLOSING_LOWER, AppConfig::SERVO_MOVE_TIME_MS);
        break;
    case DispenseState::CLOSING_LOWER:
        // The lower gate is fully closed before the upper one opens, so the next bowl cannot fall straight through.
        servoDriver.stopAll();
        servoDriver.openGate(AppConfig::UPPER_GATE_SERVOS);
        enter(DispenseState::OPENING_UPPER, AppConfig::SERVO_MOVE_TIME_MS);
        break;
    case DispenseState::OPENING_UPPER:
        servoDriver.stopAll();
        enter(DispenseState::HOLD_UPPER, AppConfig::REFILL_HOLD_MS);
        break;
    case DispenseState::HOLD_UPPER:
        servoDriver.closeGate(AppConfig::UPPER_GATE_SERVOS);
        enter(DispenseState::CLOSING_UPPER, AppConfig::SERVO_MOVE_TIME_MS);
        break;
    case DispenseState::CLOSING_UPPER:
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
    return beginManualMove(AppConfig::SERVO_MOVE_TIME_MS);
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
    case DispenseState::OPENING_LOWER: return "OPENING_LOWER";
    case DispenseState::HOLD_LOWER: return "HOLD_LOWER";
    case DispenseState::CLOSING_LOWER: return "CLOSING_LOWER";
    case DispenseState::OPENING_UPPER: return "OPENING_UPPER";
    case DispenseState::HOLD_UPPER: return "HOLD_UPPER";
    case DispenseState::CLOSING_UPPER: return "CLOSING_UPPER";
    case DispenseState::MANUAL_MOVE: return "MANUAL_MOVE";
    case DispenseState::FAULT: return "FAULT";
    }
    return "UNKNOWN";
}
