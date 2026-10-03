package com.fruitmachine.backend.user.repository;

import com.fruitmachine.backend.user.entity.Role;
import com.fruitmachine.backend.user.enums.RoleName;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoleRepository extends JpaRepository<Role, UUID> {
    Optional<Role> findByName(String name);

    default Optional<Role> findByName(RoleName name) {
        return findByName(Objects.requireNonNull(name, "Role name is required").name());
    }
}
