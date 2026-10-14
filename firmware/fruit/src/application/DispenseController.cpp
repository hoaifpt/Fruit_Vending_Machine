#include "DispenseController.h"

#include "app_config.h"

DispenseController::DispenseController(ServoDriver &servoDriver)
    : servoDriver(servoDriver) {}

void DispenseController::begin()
{
    servoDriver.stopAll();
    state = DispenseState::INITIAL_CLOSED;
    pendingState = state;
    movementActive = false;
}

void DispenseController::update()
{
    if (!movementActive ||
        millis() - movementStartedAt < AppConfig::SERVO_MOVE_TIME_MS)
    {
        return;
    }

    servoDriver.stopAll();
    state = pendingState;
    movementActive = false;
}

bool DispenseController::handleCommand(DispenseCommand command)
{
    if (command == DispenseCommand::STOP)
    {
        servoDriver.stopAll();
        movementActive = false;
        return true;
    }

    if (movementActive)
    {
        return false;
    }

    switch (state)
    {
    case DispenseState::INITIAL_CLOSED:
        servoDriver.openComponent1();
        pendingState = DispenseState::COMPONENT_1_OPEN;
        break;
    case DispenseState::COMPONENT_1_OPEN:
        servoDriver.closeComponent1();
        servoDriver.openComponent2();
        pendingState = DispenseState::COMPONENT_2_OPEN;
        break;
    case DispenseState::COMPONENT_2_OPEN:
        servoDriver.closeAll();
        pendingState = DispenseState::BOTH_CLOSED;
        break;
    case DispenseState::BOTH_CLOSED:
        state = DispenseState::INITIAL_CLOSED;
        pendingState = state;
        return true;
    }

    movementStartedAt = millis();
    movementActive = true;
    return true;
}
