#include "SerialCommandService.h"

#include <cctype>
#include <cstdlib>
#include <cstring>

#include "app_config.h"
#include "utils/Logger.h"

SerialCommandService::SerialCommandService(DispenseController &dispenser)
    : dispenser(dispenser) {}

void SerialCommandService::begin()
{
    Serial.printf("READY %s %s\n", AppConfig::FIRMWARE_VERSION, AppConfig::MACHINE_CODE);
}

void SerialCommandService::loop()
{
    while (Serial.available() > 0)
    {
        const char c = static_cast<char>(Serial.read());
        if (c == '\r')
        {
            continue;
        }
        if (c == '\n')
        {
            if (overflow)
            {
                Serial.println("ERR LINE_TOO_LONG");
            }
            else if (length > 0)
            {
                line[length] = '\0';
                handleLine(line);
            }
            length = 0;
            overflow = false;
            continue;
        }
        if (length < LINE_SIZE - 1)
        {
            line[length++] = c;
        }
        else
        {
            overflow = true;
        }
    }
}

void SerialCommandService::handleLine(char *text)
{
    char *command = strtok(text, " \t");
    if (command == nullptr)
    {
        return;
    }
    for (char *p = command; *p; p++)
    {
        *p = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
    }
    char *rest = strtok(nullptr, "");

    if (strcmp(command, "PING") == 0)
    {
        Serial.println("PONG");
    }
    else if (strcmp(command, "STATUS") == 0)
    {
        if (dispenser.cycleActive())
            Serial.printf("STATE %s %s\n", dispenser.stateName(), dispenser.activeCommandId());
        else
            Serial.printf("STATE %s\n", dispenser.stateName());
    }
    else if (strcmp(command, "DISPENSE") == 0)
    {
        char *id = rest == nullptr ? nullptr : strtok(rest, " \t");
        char *colStr = strtok(nullptr, " \t");
        uint8_t col = 1;
        if (colStr != nullptr)
        {
            int c = atoi(colStr);
            if (c == 2) col = 2;
        }
        if (id == nullptr || !validCommandId(id))
        {
            Serial.println("ERR INVALID_COMMAND_ID");
            return;
        }
        handleDispense(id, col);
    }
    else if (strcmp(command, "STOP") == 0)
    {
        dispenser.abort();
        Serial.println("STOPPED");
    }
    else if (strcmp(command, "RESET") == 0)
    {
        Serial.println(dispenser.reset() ? "RESET OK" : "ERR NOT_IN_FAULT");
    }
    else if (strcmp(command, "SERVO") == 0)
    {
        handleServo(rest);
    }
    else if (strcmp(command, "GATE") == 0)
    {
        handleGate(rest);
    }
    else
    {
        Serial.println("ERR UNKNOWN_COMMAND");
    }
}

SerialCommandService::DispenseReply SerialCommandService::requestDispense(const char *commandId, uint8_t column)
{
    if (commandId == nullptr || !validCommandId(commandId))
    {
        return DispenseReply::INVALID;
    }
    // Retry of a finished command: answer again, never dispense a second bowl.
    if (const Completed *done = findCompleted(commandId))
    {
        return done->outcome == DispenseOutcome::OK ? DispenseReply::DONE_OK : DispenseReply::DONE_ABORTED;
    }
    // Retry of the command in progress.
    if (dispenser.cycleActive() && strcmp(dispenser.activeCommandId(), commandId) == 0)
    {
        return DispenseReply::IN_PROGRESS;
    }
    if (!dispenser.start(commandId, column))
    {
        return DispenseReply::BUSY;
    }
    Logger::info("Dispense %s (column %u) started", commandId, column);
    return DispenseReply::STARTED;
}

void SerialCommandService::handleDispense(const char *commandId, uint8_t column)
{
    switch (requestDispense(commandId, column))
    {
    case DispenseReply::DONE_OK:
        Serial.printf("DONE %s OK\n", commandId);
        break;
    case DispenseReply::DONE_ABORTED:
        Serial.printf("DONE %s ABORTED\n", commandId);
        break;
    case DispenseReply::BUSY:
        Serial.printf("BUSY %s %s\n", commandId, dispenser.stateName());
        break;
    case DispenseReply::INVALID:
        Serial.println("ERR INVALID_COMMAND_ID");
        break;
    default:
        Serial.printf("ACK %s\n", commandId);
        break;
    }
}

void SerialCommandService::handleServo(char *arguments)
{
    char *number = arguments == nullptr ? nullptr : strtok(arguments, " \t");
    char *pulse = strtok(nullptr, " \t");
    char *duration = strtok(nullptr, " \t");
    if (number == nullptr || pulse == nullptr || duration == nullptr || strtok(nullptr, " \t") != nullptr)
    {
        Serial.println("ERR USAGE SERVO <1-4> <pulseUs> <ms>");
        return;
    }
    char *end = nullptr;
    const long servo = strtol(number, &end, 10);
    const bool servoOk = *end == '\0';
    const long pulseUs = strtol(pulse, &end, 10);
    const bool pulseOk = *end == '\0';
    const long ms = strtol(duration, &end, 10);
    const bool msOk = *end == '\0';
    if (!servoOk || !pulseOk || !msOk || servo < 1 || servo > ServoDriver::SERVO_COUNT || pulseUs < AppConfig::SERVO_MIN_US ||
        pulseUs > AppConfig::SERVO_MAX_US || ms < 1 || ms > static_cast<long>(AppConfig::SERVO_TEST_MAX_MS))
    {
        Serial.printf("ERR RANGE servo 1-%u, pulse %d-%d us, 1-%lu ms\n", ServoDriver::SERVO_COUNT, AppConfig::SERVO_MIN_US,
                      AppConfig::SERVO_MAX_US, AppConfig::SERVO_TEST_MAX_MS);
        return;
    }
    if (!dispenser.startServoTest(static_cast<uint8_t>(servo), static_cast<int>(pulseUs), static_cast<unsigned long>(ms)))
    {
        Serial.printf("ERR BUSY %s\n", dispenser.stateName());
        return;
    }
    Serial.println("OK SERVO");
}

void SerialCommandService::handleGate(char *arguments)
{
    char *gate = arguments == nullptr ? nullptr : strtok(arguments, " \t");
    char *action = strtok(nullptr, " \t");
    char *colStr = strtok(nullptr, " \t");
    uint8_t col = 1;
    if (colStr != nullptr)
    {
        int c = atoi(colStr);
        if (c == 2) col = 2;
    }
    if (gate == nullptr || action == nullptr)
    {
        Serial.println("ERR USAGE GATE <LOWER|UPPER> <OPEN|CLOSE> [1|2]");
        return;
    }
    for (char *p = gate; *p; p++) *p = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
    for (char *p = action; *p; p++) *p = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
    const bool lower = strcmp(gate, "LOWER") == 0, upper = strcmp(gate, "UPPER") == 0;
    const bool open = strcmp(action, "OPEN") == 0, close = strcmp(action, "CLOSE") == 0;
    if ((!lower && !upper) || (!open && !close))
    {
        Serial.println("ERR USAGE GATE <LOWER|UPPER> <OPEN|CLOSE> [1|2]");
        return;
    }
    if (!dispenser.startGateMove(lower ? Gate::LOWER : Gate::UPPER, open, col))
    {
        Serial.printf("ERR BUSY %s\n", dispenser.stateName());
        return;
    }
    Serial.println("OK GATE");
}

void SerialCommandService::reportResult(const DispenseController::Result &result)
{
    Completed &slot = completed[nextSlot];
    strncpy(slot.commandId, result.commandId, DispenseController::COMMAND_ID_SIZE);
    slot.outcome = result.outcome;
    nextSlot = (nextSlot + 1) % REMEMBERED;
    Serial.printf("DONE %s %s\n", result.commandId, outcomeName(result.outcome));
    if (result.outcome == DispenseOutcome::ABORTED)
    {
        Logger::info("Dispense %s aborted: check both gates, then send RESET", result.commandId);
    }
}

const SerialCommandService::Completed *SerialCommandService::findCompleted(const char *commandId) const
{
    for (const Completed &entry : completed)
    {
        if (entry.commandId[0] != '\0' && strcmp(entry.commandId, commandId) == 0)
        {
            return &entry;
        }
    }
    return nullptr;
}

bool SerialCommandService::validCommandId(const char *commandId)
{
    const size_t size = strlen(commandId);
    if (size == 0 || size >= DispenseController::COMMAND_ID_SIZE)
    {
        return false;
    }
    for (size_t i = 0; i < size; i++)
    {
        const char c = commandId[i];
        if (!isalnum(static_cast<unsigned char>(c)) && c != '-' && c != '_')
        {
            return false;
        }
    }
    return true;
}

const char *SerialCommandService::outcomeName(DispenseOutcome outcome)
{
    return outcome == DispenseOutcome::OK ? "OK" : "ABORTED";
}
