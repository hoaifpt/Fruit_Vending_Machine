#pragma once

#include <Arduino.h>

// Human-readable log lines on Serial start with "# " so a kiosk can tell them apart from protocol replies.
namespace Logger
{
    void info(const char *format, ...);
    void warn(const char *format, ...);
    void error(const char *errorCode, const char *format, ...);
}
