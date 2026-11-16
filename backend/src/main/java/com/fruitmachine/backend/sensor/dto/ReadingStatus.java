package com.fruitmachine.backend.sensor.dto;

/** A value compared with the machine's configured range: below min LOW, above max HIGH, otherwise NORMAL. Display only. */
public enum ReadingStatus {
    LOW, NORMAL, HIGH
}
