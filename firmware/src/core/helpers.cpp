#include "core/runtime_api.hpp"

// 7. HELPERS
// ============================================================

String jsonEscape(const String &value) {
    String out;
    out.reserve(value.length() + 8);
    for (size_t i = 0; i < value.length(); ++i) {
        const char c = value[i];
        if (c == '\\') out += "\\\\";
        else if (c == '"') out += "\\\"";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else out += c;
    }
    return out;
}

String motionStateText(MotionState st) {
    switch (st) {
        case STATE_IDLE:                    return "San sang";
        case STATE_FORWARD:                 return "Dang quay thuan";
        case STATE_PAUSE_AFTER_FORWARD:     return "Dang dung";
        case STATE_REVERSE:                 return "Dang quay nghich";
        case STATE_PAUSE_AFTER_REVERSE:     return "Dang dung";
        case STATE_MANUAL_FORWARD:          return "Test thuan";
        case STATE_MANUAL_REVERSE:          return "Test nghich";
        case STATE_OPENING:                 return "Dang mo";
        case STATE_OPENED:                  return "Da mo";
        case STATE_CLOSING:                 return "Dang dong";
        case STATE_CLOSED:                  return "Da dong";
        case STATE_COMPLETE:                return "Hoan thanh";
        case STATE_ERROR:                   return "Loi";
        default:                            return "Khong xac dinh";
    }
}

String colDispenseStateText(ColumnDispenseState st) {
    switch (st) {
        case COL_IDLE:                     return "San sang";
        case COL_DISPENSE_LOWER_OPEN:      return "Mo servo duoi";
        case COL_DISPENSE_LOWER_HOLD:      return "Nha to ra";
        case COL_DISPENSE_LOWER_CLOSE:     return "Dong servo duoi";
        case COL_DISPENSE_PAUSE_MID:       return "Tam dung giua";
        case COL_DISPENSE_UPPER_OPEN:      return "Mo servo tren";
        case COL_DISPENSE_UPPER_HOLD:      return "To tren roi xuong";
        case COL_DISPENSE_UPPER_CLOSE:     return "Khoa servo tren";
        case COL_DISPENSE_COMPLETE:        return "Hoan tat tra do";
        default:                           return "IDLE";
    }
}

String motionStateText() {
    return motionStateText(motionState1);
}

bool motionIsRunning(MotionState st) {
    return st == STATE_FORWARD ||
           st == STATE_PAUSE_AFTER_FORWARD ||
           st == STATE_REVERSE ||
           st == STATE_PAUSE_AFTER_REVERSE ||
           st == STATE_MANUAL_FORWARD ||
           st == STATE_MANUAL_REVERSE ||
           st == STATE_OPENING ||
           st == STATE_CLOSING;
}

bool motionIsRunning() {
    return motionIsRunning(motionState1) || motionIsRunning(motionState2) ||
           motionIsRunning(motionState3) || motionIsRunning(motionState4) ||
           col1DispenseState != COL_IDLE || col2DispenseState != COL_IDLE;
}

bool parseIntStrict(const String &text, int &value) {
    if (text.length() == 0) return false;
    char *endptr = nullptr;
    long v = strtol(text.c_str(), &endptr, 10);
    if (!endptr || *endptr != '\0') return false;
    value = (int)v;
    return true;
}

bool parseUnsignedLongStrict(const String &text, unsigned long &value) {
    if (text.length() == 0) return false;
    char *endptr = nullptr;
    unsigned long v = strtoul(text.c_str(), &endptr, 10);
    if (!endptr || *endptr != '\0') return false;
    value = v;
    return true;
}

void sendJsonError(int statusCode, const String &message) {
    String payload = "{";
    payload += "\"ok\":false,";
    payload += "\"error\":\"" + jsonEscape(message) + "\"";
    payload += "}";
    server.send(statusCode, "application/json; charset=utf-8", payload);
}

void sendJsonOk(const String &message) {
    String payload = "{";
    payload += "\"ok\":true";
    if (message.length() > 0) {
        payload += ",\"message\":\"" + jsonEscape(message) + "\"";
    }
    payload += "}";
    server.send(200, "application/json; charset=utf-8", payload);
}

// ============================================================
