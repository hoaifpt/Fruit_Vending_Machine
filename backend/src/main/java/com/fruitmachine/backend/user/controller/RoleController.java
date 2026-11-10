package com.fruitmachine.backend.user.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.user.dto.ReplaceRolePermissionsRequest;
import com.fruitmachine.backend.user.dto.RoleResponse;
import com.fruitmachine.backend.user.service.RolePermissionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/roles", produces = "application/json")
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
public class RoleController {
    static final String TAG_DESCRIPTION = "Roles are sets of permissions; every protected endpoint checks a permission. An account with PERMISSION_MANAGE "
            + "views roles and the catalog and replaces a role's permission set; changes apply on each member's next request. Roles and permissions "
            + "cannot be created, renamed or deleted here.";
    private final RolePermissionService service;

    @PreAuthorize(Permissions.HAS_PERMISSION_MANAGE)
    @GetMapping
    @Operation(operationId = "listRoles", summary = "List roles with their permissions",
            description = "Requires PERMISSION_MANAGE. Every role with its sorted permission codes.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Roles")
    public ResponseEntity<ApiResponse<List<RoleResponse>>> list() {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Roles retrieved", service.listRoles()));
    }

    @PreAuthorize(Permissions.HAS_PERMISSION_MANAGE)
    @GetMapping("/{id}")
    @Operation(operationId = "getRole", summary = "Get a role", description = "Requires PERMISSION_MANAGE. The role with its sorted permission codes.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Role"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed role UUID",
                content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Role not found",
                content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<RoleResponse>> get(@PathVariable @Parameter(description = "Role UUID.") UUID id) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Role retrieved", service.getRole(id)));
    }

    @PreAuthorize(Permissions.HAS_PERMISSION_MANAGE)
    @PutMapping(value = "/{id}/permissions", consumes = "application/json")
    @Operation(operationId = "replaceRolePermissions", summary = "Replace the permission set of a role",
            description = "Requires PERMISSION_MANAGE. Replaces the whole set (an empty list leaves the role without access). Unknown or duplicate codes "
                    + "are rejected (400, codes listed in fieldErrors). The ADMIN role must keep PERMISSION_MANAGE and USER_WRITE (409). The role row is "
                    + "locked while replacing, so concurrent changes never lose an update. One audit_logs row ROLE_PERMISSIONS_CHANGED records the old "
                    + "and new sorted codes and the actor. Members get the new permissions on their next request; the JWT does not change.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Role with its new permission set"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Validation failure, unknown or duplicate codes, unknown JSON fields",
                content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Role not found",
                content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Would remove PERMISSION_MANAGE or USER_WRITE from ADMIN",
                content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<RoleResponse>> replace(@PathVariable @Parameter(description = "Role UUID.") UUID id,
            @Valid @RequestBody ReplaceRolePermissionsRequest request) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Role permissions replaced", service.replacePermissions(id, request)));
    }
}
