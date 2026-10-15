package com.fruitmachine.backend.machine.kiosk.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.machine.kiosk.dto.IssuedKioskCredentialResponse;
import com.fruitmachine.backend.machine.kiosk.dto.KioskCredentialResponse;
import com.fruitmachine.backend.machine.kiosk.service.KioskCredentialService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping(value = "/api/v1/machines/{machineId}/kiosk-credentials", produces = "application/json")
@PreAuthorize("hasRole('ADMIN')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Kiosk Credentials", description = "ADMIN-only management of machine-bound kiosk API keys. The plaintext key is shown once, only its SHA-256 digest is stored. STAFF cannot read credential metadata.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account is not ADMIN", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine or machine-scoped credential not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class KioskCredentialController {
    private final KioskCredentialService credentials;

    @PostMapping
    @Operation(operationId = "issueKioskCredential", summary = "Issue (rotate) the kiosk credential of a machine",
            description = "ADMIN only. No request body. In one transaction under the machine row lock: revokes the current ACTIVE credential, if any, and creates a new one. "
                    + "The previous key stops working immediately. The plaintext apiKey is returned once and never again.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Credential issued; plaintext key included once")
    public ResponseEntity<ApiResponse<IssuedKioskCredentialResponse>> issue(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId) {
        return ResponseEntity.status(201).header("Cache-Control", "no-store")
                .body(ApiResponse.success("Kiosk credential issued", credentials.issue(machineId)));
    }

    @GetMapping
    @Operation(operationId = "listKioskCredentials", summary = "List kiosk credential metadata of a machine",
            description = "ADMIN only. Metadata history, newest first: credentialId, keyPrefix, status, createdAt/By, revokedAt/By. Never returns keys, secrets or hashes.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Credential metadata")
    public ResponseEntity<ApiResponse<List<KioskCredentialResponse>>> list(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId) {
        return ok("Kiosk credentials retrieved", credentials.list(machineId));
    }

    @PostMapping("/{credentialId}/revoke")
    @Operation(operationId = "revokeKioskCredential", summary = "Revoke a kiosk credential",
            description = "ADMIN only. ACTIVE becomes REVOKED. Revoking an already REVOKED credential returns 200 unchanged (idempotent). A credential of another machine returns 404. Rows are retained as history.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Credential is REVOKED")
    public ResponseEntity<ApiResponse<KioskCredentialResponse>> revoke(@PathVariable @Parameter(description = "Machine UUID.") UUID machineId,
            @PathVariable @Parameter(description = "Credential UUID.") UUID credentialId) {
        return ok("Kiosk credential revoked", credentials.revoke(machineId, credentialId));
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
