package com.fruitmachine.backend.user.repository;

import com.fruitmachine.backend.user.entity.Role;
import com.fruitmachine.backend.user.enums.RoleName;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RoleRepository extends JpaRepository<Role, UUID> {
    Optional<Role> findByName(String name);

    default Optional<Role> findByName(RoleName name) {
        return findByName(Objects.requireNonNull(name, "Role name is required").name());
    }

    @EntityGraph(attributePaths = "permissionGrants.permission")
    @Query("select r from Role r order by r.name")
    List<Role> findAllWithPermissions();

    @EntityGraph(attributePaths = "permissionGrants.permission")
    @Query("select r from Role r where r.id = :id")
    Optional<Role> findWithPermissionsById(@Param("id") UUID id);

    /** Serializes permission replacements of one role (no lost update). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Role r where r.id = :id")
    Optional<Role> findForUpdateById(@Param("id") UUID id);
}
