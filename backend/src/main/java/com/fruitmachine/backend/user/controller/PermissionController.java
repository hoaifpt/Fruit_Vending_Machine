package com.fruitmachine.backend.user.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.user.dto.PermissionResponse;
import com.fruitmachine.backend.user.service.RolePermissionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/permissions", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Roles & Permissions", description = RoleController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account",
            content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks PERMISSION_MANAGE",
            content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server/configuration error; no internal details",
            content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class PermissionController {
    private final RolePermissionService service;

    @PreAuthorize(Permissions.HAS_PERMISSION_MANAGE)
    @GetMapping
    @Operation(operationId = "listPermissions", summary = "List all permissions",
            description = "Requires PERMISSION_MANAGE. The full catalog (code, description) sorted by code. Permissions are added by migrations only.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Permission catalog")
    public ResponseEntity<ApiResponse<List<PermissionResponse>>> list() {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Permissions retrieved", service.listPermissions()));
    }
}
