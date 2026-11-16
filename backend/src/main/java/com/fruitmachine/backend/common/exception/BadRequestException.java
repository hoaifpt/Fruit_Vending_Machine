package com.fruitmachine.backend.common.exception;

import java.util.Map;

public class BadRequestException extends RuntimeException {
    private final Map<String, String> fieldErrors;

    public BadRequestException(String message) {
        this(message, Map.of());
    }

    /** A 400 that also reports which request fields were wrong (rendered as fieldErrors). */
    public BadRequestException(String message, Map<String, String> fieldErrors) {
        super(message);
        this.fieldErrors = fieldErrors == null ? Map.of() : Map.copyOf(fieldErrors);
    }

    public Map<String, String> getFieldErrors() {
        return fieldErrors;
    }
}
