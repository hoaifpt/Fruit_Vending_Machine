package com.fruitmachine.backend.common.response;

import java.time.Instant;
import java.util.Objects;

public record ApiResponse<T>(Instant timestamp, String message, T data) {
    public static <T> ApiResponse<T> success(String message, T data) {
        return new ApiResponse<>(Instant.now(), Objects.requireNonNull(message), data);
    }
}
