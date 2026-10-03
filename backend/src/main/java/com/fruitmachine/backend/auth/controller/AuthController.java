package com.fruitmachine.backend.auth.controller;

import com.fruitmachine.backend.auth.dto.LoginRequest;
import com.fruitmachine.backend.auth.dto.LoginResponse;
import com.fruitmachine.backend.auth.service.AuthService;
import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
@Tag(name = "Auth", description = "Management authentication; ADMIN/STAFF endpoint policies are not implemented yet.")
public class AuthController {
    private final AuthService auth;

    @PostMapping(value = "/login", consumes = "application/json", produces = "application/json")
    @Operation(operationId = "login", summary = "Login using email and password",
            description = "Public endpoint. Only ACTIVE accounts may login. Returns a stateless access token; no refresh token. "
                    + "Send it as `Authorization: Bearer YOUR_ACCESS_TOKEN` for protected APIs. Existing users must have BCrypt password hashes. "
                    + "Unknown email, incorrect password, INACTIVE and LOCKED accounts return the same generic 401. "
                    + "Do not attach an expired/invalid Authorization header to this public endpoint.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Authenticated; response is not cacheable"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Missing/malformed JSON or invalid email/password",
                content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Invalid email or password, unavailable account, or invalid Bearer header",
                content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details",
                content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<LoginResponse>> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").header("Pragma", "no-cache")
                .body(ApiResponse.success("Login successful", auth.login(request)));
    }
}
