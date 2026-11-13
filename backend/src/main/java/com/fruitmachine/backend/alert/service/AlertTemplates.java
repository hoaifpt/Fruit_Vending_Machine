package com.fruitmachine.backend.alert.service;

import com.fruitmachine.backend.alert.enums.AlertType;
import java.math.BigDecimal;

/**
 * Vietnamese title/message of each alert, shown in the portal and copied to notifications. Responses also carry type and errorCode,
 * so a frontend may localize instead.
 */
public final class AlertTemplates {
    private AlertTemplates() {
    }

    public static String title(AlertType type, String errorCode) {
        return switch (type) {
            case MACHINE_OFFLINE -> "Máy mất kết nối";
            case HIGH_TEMPERATURE -> "Nhiệt độ quá cao";
            case LOW_TEMPERATURE -> "Nhiệt độ quá thấp";
            case HIGH_HUMIDITY -> "Độ ẩm quá cao";
            case LOW_STOCK -> "Ngăn sắp hết hàng";
            case PRODUCT_EXPIRING -> "Hàng sắp hết hạn";
            case PRODUCT_EXPIRED -> "Hàng đã hết hạn";
            case DISPENSE_FAILED -> "Nhả hàng thất bại";
            case HARDWARE_FAULT -> "Lỗi phần cứng: " + errorCode;
        };
    }

    public static String offline(String machineCode) {
        return "Máy " + machineCode + " không gửi tín hiệu quá ngưỡng cho phép hoặc đã báo mất kết nối.";
    }

    public static String temperature(String machineCode, BigDecimal value, BigDecimal min, BigDecimal max) {
        return "Máy " + machineCode + ": nhiệt độ " + value + " °C ngoài khoảng " + min + "–" + max + " °C. Máy đã chuyển sang bảo trì.";
    }

    public static String humidity(String machineCode, BigDecimal value, BigDecimal max) {
        return "Máy " + machineCode + ": độ ẩm " + value + " % vượt mức tối đa " + max + " %.";
    }

    public static String lowStock(String machineCode, String slotCode, long sellable) {
        return "Máy " + machineCode + ", ngăn " + slotCode + ": còn " + sellable + " hộp bán được.";
    }

    public static String expiring(String machineCode, String slotCode, long bowls) {
        return "Máy " + machineCode + ", ngăn " + slotCode + ": " + bowls + " hộp sắp hết hạn.";
    }

    public static String expired(String machineCode, String slotCode, long bowls) {
        return "Máy " + machineCode + ", ngăn " + slotCode + ": " + bowls + " hộp đã hết hạn, cần gỡ khỏi máy.";
    }

    public static String dispenseFailed(String machineCode, String slotCode, String commandCode, String reason, boolean bowlReturned) {
        return "Máy " + machineCode + ", ngăn " + slotCode + ": lệnh " + commandCode + " thất bại (" + reason + "). "
                + (bowlReturned ? "Hộp chưa rời máy và đã được trả lại." : "Không rõ hộp đã rơi chưa: kiểm tra ngăn, máy đã chuyển sang bảo trì.");
    }

    public static String hardwareFault(String machineCode, String errorCode, boolean maintenance) {
        return "Máy " + machineCode + " báo lỗi " + errorCode + "." + (maintenance ? " Máy đã chuyển sang bảo trì." : "");
    }
}
