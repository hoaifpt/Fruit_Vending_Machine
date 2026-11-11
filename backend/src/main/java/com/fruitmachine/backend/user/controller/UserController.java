package com.fruitmachine.backend.user.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.user.dto.*;
import com.fruitmachine.backend.user.enums.RoleName;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.net.URI;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/api/v1/users", produces = "application/json")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Users", description = "Management accounts. Every operation requires an ACTIVE ADMIN; STAFF receives 403.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters, validation failure or malformed/unknown JSON fields",
            content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account",
            content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks ADMIN access",
            content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server/configuration error; no internal details",
            content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class UserController {
    private final UserService users;

    @GetMapping
    @Operation(operationId = "listUsers", summary = "List management users",
            description = "ADMIN only. Database pagination with optional combined status/role filters. Stable order: createdAt descending, UUID ascending. "
                    + "Default page 0, size 20; maximum size 100. Returns all account types without credentials. Out-of-range pages are empty.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Paginated safe account profiles")
    public ResponseEntity<ApiResponse<UserPageResponse>> list(
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size, 1 to 100.") int size,
            @RequestParam(required = false) @Parameter(description = "Optional account status filter.") UserStatus status,
            @RequestParam(required = false) @Parameter(description = "Optional ADMIN or STAFF membership filter; roles remain independent.") RoleName role) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Users retrieved", users.listUsers(page, size, status, role)));
    }

    @GetMapping("/{id}")
    @Operation(operationId = "getUser", summary = "Get management user details", description = "ADMIN only. Returns a safe profile and current roles for the account UUID.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Safe account profile"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "User not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<UserResponse>> get(@PathVariable @Parameter(description = "Account UUID.") UUID id) {
        return success("User retrieved", users.getUser(id));
    }

    @PostMapping(consumes = "application/json")
    @Operation(operationId = "createStaff", summary = "Create an operational STAFF account",
            description = "ADMIN only. Atomically creates an ACTIVE account with the existing STAFF role and BCrypt password. "
                    + "Email is stripped/lowercased, unique across all accounts. Password uses shared PASSWORD_MIN_LENGTH (default 12 code points), maximum 72 UTF-8 bytes. "
                    + "Only email, password, fullName and optional phone are accepted. Role/status/id/timestamp fields are rejected. A missing STAFF role returns safe 500.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "ACTIVE STAFF created; Location points to the new account"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Email already exists or concurrent database uniqueness conflict", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<UserResponse>> create(@Valid @RequestBody CreateUserRequest request) {
        var user = users.createStaff(request);
        return ResponseEntity.created(URI.create("/api/v1/users/" + user.id())).header("Cache-Control", "no-store")
                .body(ApiResponse.success("STAFF account created", user));
    }

    @PutMapping(value = "/{id}", consumes = "application/json")
    @Operation(operationId = "updateUser", summary = "Update management user profile",
            description = "ADMIN only. Replaces fullName and phone. Omitted/null phone clears it. Email, password, roles, status and persistence fields are rejected. "
                    + "Account identity, membership and history are preserved.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Updated safe account profile"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "User not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<UserResponse>> update(@PathVariable @Parameter(description = "Account UUID.") UUID id,
            @Valid @RequestBody UpdateUserRequest request) {
        return success("User updated", users.updateUser(id, request));
    }

    @PatchMapping(value = "/{id}/status", consumes = "application/json")
    @Operation(operationId = "updateUserStatus", summary = "Change management user status",
            description = "ADMIN only. Sets ACTIVE, INACTIVE or LOCKED, preserving the account and its roles/history. "
                    + "INACTIVE/LOCKED immediately prevents login and reuse of issued JWTs. Self-disable/lock and disabling/locking the last ACTIVE ADMIN return 409. "
                    + "Status decisions are serialized and the acting ADMIN is rechecked after obtaining the lock; a concurrently disabled actor receives 403. Same-status requests are idempotent.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Safe profile with current status"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "User not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Self-lockout or last ACTIVE ADMIN conflict", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<UserResponse>> status(@PathVariable @Parameter(description = "Account UUID.") UUID id,
            @Valid @RequestBody UpdateUserStatusRequest request) {
        return success("User status updated", users.updateStatus(id, request));
    }

    private ResponseEntity<ApiResponse<UserResponse>> success(String message, UserResponse user) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, user));
    }
}
