#pragma once

#include <Arduino.h>

#include "application/DispenseController.h"

// Line protocol on USB Serial (115200, '\n'), DRAFT until the kiosk/tablet dispense channel issue fixes it.
// Requests:  PING | STATUS | DISPENSE <commandId> | STOP | RESET | GATE <LOWER|UPPER> <OPEN|CLOSE> | SERVO <1-4> <pulseUs> <ms>
// Replies:   READY <fw> <machineCode> | PONG | STATE <state> [<commandId>] | ACK <id> | BUSY <id> <state> |
//            DONE <id> OK|ABORTED | STOPPED | RESET OK | OK GATE | OK SERVO | ERR <reason>
// Lines starting with "# " are logs, not replies. DISPENSE is idempotent: a repeated commandId never moves a servo again.
class SerialCommandService
{
public:
    explicit SerialCommandService(DispenseController &dispenser);

    void begin();
    void loop();
    // Called by the main loop when a cycle finished; prints DONE and remembers the outcome for retries.
    void reportResult(const DispenseController::Result &result);

private:
    static constexpr size_t LINE_SIZE = 96;
    static constexpr size_t REMEMBERED = 8;

    struct Completed
    {
        char commandId[DispenseController::COMMAND_ID_SIZE];
        DispenseOutcome outcome;
    };

    DispenseController &dispenser;
    char line[LINE_SIZE] = {};
    size_t length = 0;
    bool overflow = false;
    Completed completed[REMEMBERED] = {};
    size_t nextSlot = 0;

    void handleLine(char *text);
    void handleDispense(const char *commandId);
    void handleServo(char *arguments);
    void handleGate(char *arguments);
    const Completed *findCompleted(const char *commandId) const;
    static bool validCommandId(const char *commandId);
    static const char *outcomeName(DispenseOutcome outcome);
};
