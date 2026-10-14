
#pragma once

enum class DispenseState
{
    INITIAL_CLOSED,
    COMPONENT_1_OPEN,
    COMPONENT_2_OPEN,
    BOTH_CLOSED
};

enum class DispenseCommand
{
    NEXT,
    STOP
};
