#pragma once

#include <Arduino.h>

#include "DispenseState.h"
#include "hal/ServoDriver.h"

class DispenseController
{
public:
    explicit DispenseController(ServoDriver &servoDriver);

    void begin();
    void update();
    bool handleCommand(DispenseCommand command);

private:
    ServoDriver &servoDriver;
    DispenseState state = DispenseState::INITIAL_CLOSED;
    DispenseState pendingState = DispenseState::INITIAL_CLOSED;
    unsigned long movementStartedAt = 0;
    bool movementActive = false;
};
