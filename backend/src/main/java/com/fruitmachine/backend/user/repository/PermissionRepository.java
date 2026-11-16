package com.fruitmachine.backend.user.repository;

import com.fruitmachine.backend.user.entity.Permission;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PermissionRepository extends JpaRepository<Permission, UUID> {
    List<Permission> findAllByOrderByCodeAsc();

    List<Permission> findByCodeIn(Collection<String> codes);
}
