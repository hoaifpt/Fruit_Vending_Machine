package com.fruitmachine.backend.user.dto;

import com.fruitmachine.backend.user.enums.UserStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

@Schema(description = "Safe account profile. No credentials or tokens. Timestamps are UTC instants.")
public record UserResponse(
        @Schema(description = "Account UUID.", format = "uuid", requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
        @Schema(description = "Normalized login email.", format = "email", requiredMode = Schema.RequiredMode.REQUIRED) String email,
        @Schema(description = "Display name.", requiredMode = Schema.RequiredMode.REQUIRED) String fullName,
        @Schema(description = "Optional contact phone.", types = {"string", "null"}) String phone,
        @Schema(description = "Current account availability.", requiredMode = Schema.RequiredMode.REQUIRED) UserStatus status,
        @Schema(description = "Distinct current role names, including ADMIN/STAFF; existing extensible roles are preserved.",
                requiredMode = Schema.RequiredMode.REQUIRED) Set<String> roles,
        @Schema(description = "Account creation instant.", requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
        @Schema(description = "Last profile/status modification instant.", requiredMode = Schema.RequiredMode.REQUIRED) Instant updatedAt) { }
