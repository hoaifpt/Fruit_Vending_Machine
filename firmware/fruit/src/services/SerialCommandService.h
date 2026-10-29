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
    // Answer to a dispense request from any channel (USB Serial or MQTT).
    enum class DispenseReply
    {
        STARTED,      // a new cycle started
        IN_PROGRESS,  // this commandId is the cycle running now
        DONE_OK,      // this commandId already finished OK: nothing moves
        DONE_ABORTED, // this commandId already finished ABORTED: nothing moves
        BUSY,         // another cycle/test is running, or FAULT
        INVALID       // commandId is not 1-39 characters of [A-Za-z0-9_-]
    };

    explicit SerialCommandService(DispenseController &dispenser);

    // Idempotent: the same commandId never dispenses twice (the last REMEMBERED ids are kept).
    DispenseReply requestDispense(const char *commandId, uint8_t column = 1);

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
    void handleDispense(const char *commandId, uint8_t column = 1);
    void handleServo(char *arguments);
    void handleGate(char *arguments);
    const Completed *findCompleted(const char *commandId) const;
    static bool validCommandId(const char *commandId);
    static const char *outcomeName(DispenseOutcome outcome);
};
