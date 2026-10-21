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
        Serial.print("# ");
        Serial.println(line);
    }
}
