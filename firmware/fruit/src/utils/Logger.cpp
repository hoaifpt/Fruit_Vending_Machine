#include "Logger.h"

#include <cstdarg>

namespace Logger
{
    void info(const char *format, ...)
    {
        char line[160];
        va_list args;
        va_start(args, format);
        vsnprintf(line, sizeof(line), format, args);
        va_end(args);
        Serial.print("# [INFO] ");
        Serial.println(line);
    }

    void warn(const char *format, ...)
    {
        char line[160];
        va_list args;
        va_start(args, format);
        vsnprintf(line, sizeof(line), format, args);
        va_end(args);
        Serial.print("# [WARN] ");
        Serial.println(line);
    }

    void error(const char *errorCode, const char *format, ...)
    {
        char line[160];
        va_list args;
        va_start(args, format);
        vsnprintf(line, sizeof(line), format, args);
        va_end(args);
        Serial.printf("# [ERROR][%s] ", errorCode ? errorCode : "ERR");
        Serial.println(line);
    }
}
