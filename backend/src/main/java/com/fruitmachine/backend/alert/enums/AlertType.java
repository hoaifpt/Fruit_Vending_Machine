package com.fruitmachine.backend.alert.enums;

import com.fruitmachine.backend.alert.entity.Alert;

public enum AlertType {
    HIGH_TEMPERATURE, LOW_TEMPERATURE, HIGH_HUMIDITY, MACHINE_OFFLINE, PRODUCT_EXPIRED, PRODUCT_EXPIRING, DISPENSE_FAILED, LOW_STOCK,
    /** Machine-reported fault, bad reboot or multi-bowl release; error_code says which (V17). */
    HARDWARE_FAULT
}
