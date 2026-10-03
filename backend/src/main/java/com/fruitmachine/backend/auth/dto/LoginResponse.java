package com.fruitmachine.backend.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

public record LoginResponse(
        @Schema(description = "Signed HS256 JWT access token. Never log or share it.", requiredMode = Schema.RequiredMode.REQUIRED)
        String accessToken,
        @Schema(allowableValues = "Bearer", requiredMode = Schema.RequiredMode.REQUIRED)
        String tokenType,
        @Schema(description = "Access token lifetime in seconds", example = "3600", minimum = "1", maximum = "86400",
                requiredMode = Schema.RequiredMode.REQUIRED)
        long expiresIn) {
    @Override
    public String toString() {
        return "LoginResponse[accessToken=REDACTED, tokenType=" + tokenType + ", expiresIn=" + expiresIn + "]";
    }
}
