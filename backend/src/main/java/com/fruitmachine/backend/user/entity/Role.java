package com.fruitmachine.backend.user.entity;

import com.fruitmachine.backend.common.entity.CreatedEntity;

import jakarta.persistence.*;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "roles")
@Getter
@Setter
@NoArgsConstructor
public class Role extends CreatedEntity {
    @Column(name = "name", length = 32, nullable = false, unique = true)
    private String name;

    @Column(name = "description", length = 255)
    private String description;

    @OneToMany(mappedBy = "role", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<UserRole> userMemberships = new HashSet<>();

    // No cascade: grants are replaced explicitly by RolePermissionService.
    @OneToMany(mappedBy = "role", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<RolePermission> permissionGrants = new HashSet<>();

    public Set<Permission> getPermissions() {
        return permissionGrants.stream().map(RolePermission::getPermission).collect(Collectors.toUnmodifiableSet());
    }
}
