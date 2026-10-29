
#pragma once

// One dispense = one full cycle (one bowl, backend rule "one purchase = one bowl").
// The bowl in dispensing position rests on the LOWER gate; the rest of the column rests on the UPPER gate.
// The two gates are never open at the same time.
enum class DispenseState
{
    IDLE,
    LOCK_UPPER,          // tighten upper gate before opening lower gate to hold remaining bowls firmly
    OPENING_LOWER,       // lower gate opens: the bowl in position falls out to the customer
    HOLD_LOWER,          // lower gate stays open while the bowl falls
    CLOSING_LOWER,       // lower gate closes
    PAUSE_BETWEEN_GATES, // pause ~5s between mechanisms (lower gate closed & holding, waiting before refill)
    OPENING_UPPER,       // upper gate opens: the next bowl falls into position
    HOLD_UPPER,          // upper gate stays open while the next bowl falls
    CLOSING_UPPER,       // upper gate closes; the machine is ready for the next order
    MANUAL_MOVE,         // calibration / manual gate movement (SERVO or GATE command)
    FAULT                // interrupted mid-movement: gate positions unknown until an operator checks and sends RESET
};

enum class DispenseOutcome
{
    OK,
    ABORTED
};

enum class Gate
{
    LOWER,
    UPPER
};
