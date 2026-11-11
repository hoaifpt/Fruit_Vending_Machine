#pragma once

namespace ErrorCode
{
    constexpr char NONE[] = "NONE";
    constexpr char ERR_SERVO_INIT[] = "ERR_SERVO_INIT";               // Lỗi khởi tạo/gắn chân servo
    constexpr char ERR_MACHINE_BUSY[] = "ERR_MACHINE_BUSY";           // Máy đang bận xử lý chu trình khác
    constexpr char ERR_SYSTEM_FAULT[] = "ERR_SYSTEM_FAULT";           // Bộ điều khiển ở trạng thái FAULT (cần RESET)
    constexpr char ERR_DISPENSE_ABORTED[] = "ERR_DISPENSE_ABORTED";   // Chu trình nhả bị dừng khẩn cấp
    constexpr char ERR_INVALID_COMMAND_ID[] = "ERR_INVALID_COMMAND_ID"; // commandId không hợp lệ/rỗng/quá dài
    constexpr char ERR_INVALID_COLUMN[] = "ERR_INVALID_COLUMN";       // Khay không hợp lệ (không phải A hoặc B)
    constexpr char ERR_INVALID_OPERATION[] = "ERR_INVALID_OPERATION"; // Lệnh bảo trì không hợp lệ
    constexpr char ERR_MALFORMED_JSON[] = "ERR_MALFORMED_JSON";       // JSON từ broker không đúng cú pháp
    constexpr char ERR_WIFI_DISCONNECTED[] = "ERR_WIFI_DISCONNECTED"; // Mất kết nối Wi-Fi
    constexpr char ERR_MQTT_DISCONNECTED[] = "ERR_MQTT_DISCONNECTED"; // Mất kết nối MQTT broker
    constexpr char ERR_LINE_TOO_LONG[] = "ERR_LINE_TOO_LONG";         // Buffer dòng lệnh Serial tràn
    constexpr char ERR_UNKNOWN_COMMAND[] = "ERR_UNKNOWN_COMMAND";     // Lệnh Serial không nhận diện
}
