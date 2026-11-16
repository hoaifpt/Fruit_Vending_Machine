package com.fruitmachine.backend.user.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.dto.PermissionResponse;
import com.fruitmachine.backend.user.dto.ReplaceRolePermissionsRequest;
import com.fruitmachine.backend.user.dto.RoleResponse;
import com.fruitmachine.backend.user.entity.Permission;
import com.fruitmachine.backend.user.entity.Role;
import com.fruitmachine.backend.user.entity.RolePermission;
import com.fruitmachine.backend.user.enums.RoleName;
import com.fruitmachine.backend.user.repository.PermissionRepository;
import com.fruitmachine.backend.user.repository.RolePermissionRepository;
import com.fruitmachine.backend.user.repository.RoleRepository;
import com.fruitmachine.backend.user.repository.UserRepository;
import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

/**
 * Roles and permissions (issue #48). Roles and permissions are reference data: only a role's permission set can change.
 * A change applies to every member's next request, because authorities are loaded from the database per request.
 */
@Service
@RequiredArgsConstructor
@Validated
public class RolePermissionService {
    public static final String AUDIT_ACTION = "ROLE_PERMISSIONS_CHANGED";

    private final RoleRepository roles;
    private final PermissionRepository permissions;
    private final RolePermissionRepository grants;
    private final UserRepository users;
    private final AuditLogRepository audits;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_PERMISSION_MANAGE)
    public List<PermissionResponse> listPermissions() {
        return permissions.findAllByOrderByCodeAsc().stream().map(p -> new PermissionResponse(p.getCode(), p.getDescription())).toList();
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_PERMISSION_MANAGE)
    public List<RoleResponse> listRoles() {
        return roles.findAllWithPermissions().stream().map(RolePermissionService::toResponse).toList();
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_PERMISSION_MANAGE)
    public RoleResponse getRole(UUID id) {
        return toResponse(roles.findWithPermissionsById(id).orElseThrow(RolePermissionService::missing));
    }

    /**
     * Replaces the whole permission set. Order: request validation (400), role row lock FOR UPDATE (404), lockout guard (409),
     * replace, one audit row. The old set is read under the lock, so two concurrent replacements never lose an update.
     */
    @Transactional
    @PreAuthorize(Permissions.HAS_PERMISSION_MANAGE)
    public RoleResponse replacePermissions(UUID id, @Valid ReplaceRolePermissionsRequest request) {
        List<String> requested = request.permissions();
        Set<String> duplicates = requested.stream().filter(code -> requested.indexOf(code) != requested.lastIndexOf(code))
                .collect(Collectors.toCollection(TreeSet::new));
        if (!duplicates.isEmpty()) {
            throw new BadRequestException("Duplicate permission codes", Map.of("permissions", "Duplicate codes: " + String.join(", ", duplicates)));
        }
        Set<String> codes = new LinkedHashSet<>(requested);
        List<Permission> found = codes.isEmpty() ? List.of() : permissions.findByCodeIn(codes);
        if (found.size() != codes.size()) {
            Set<String> unknown = new TreeSet<>(codes);
            found.forEach(p -> unknown.remove(p.getCode()));
            throw new BadRequestException("Unknown permission codes", Map.of("permissions", "Unknown codes: " + String.join(", ", unknown)));
        }

        Role role = roles.findForUpdateById(id).orElseThrow(RolePermissionService::missing);
        if (RoleName.ADMIN.name().equals(role.getName())) {
            List<String> missingRequired = Permissions.ADMIN_REQUIRED.stream().filter(code -> !codes.contains(code)).sorted().toList();
            if (!missingRequired.isEmpty()) {
                throw new ConflictException("The ADMIN role must keep " + String.join(" and ", Permissions.ADMIN_REQUIRED)
                        + "; otherwise nobody could manage users or permissions");
            }
        }
        List<String> before = grants.findCodesByRoleId(role.getId());
        grants.deleteByRoleId(role.getId());
        grants.saveAll(found.stream().map(permission -> new RolePermission(role, permission)).toList());
        grants.flush();
        List<String> after = new ArrayList<>(new TreeSet<>(codes));

        var principal = (AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        var row = new AuditLog();
        row.setUser(users.getReferenceById(principal.getId()));
        row.setAction(AUDIT_ACTION);
        row.setEntityType("Role");
        row.setEntityId(role.getId());
        row.setOldValue(codesNode(before));
        row.setNewValue(codesNode(after));
        audits.save(row);
        return new RoleResponse(role.getId(), role.getName(), role.getDescription(), after);
    }

    private static JsonNode codesNode(List<String> codes) {
        var node = JsonNodeFactory.instance.objectNode();
        var array = node.putArray("permissions");
        codes.stream().sorted().forEach(array::add);
        return node;
    }

    private static RoleResponse toResponse(Role role) {
        return new RoleResponse(role.getId(), role.getName(), role.getDescription(),
                role.getPermissions().stream().map(Permission::getCode).sorted().toList());
    }

    private static ResourceNotFoundException missing() {
        return new ResourceNotFoundException("Role not found");
    }
}
