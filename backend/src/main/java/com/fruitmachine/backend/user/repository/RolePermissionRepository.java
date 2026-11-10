package com.fruitmachine.backend.user.repository;

import com.fruitmachine.backend.user.entity.RolePermission;
import com.fruitmachine.backend.user.entity.RolePermissionId;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RolePermissionRepository extends JpaRepository<RolePermission, RolePermissionId> {
    /** Current codes read from the table (not a cached collection), so the value seen under the role lock is authoritative. */
    @Query("select p.code from RolePermission rp join rp.permission p where rp.role.id = :roleId order by p.code")
    List<String> findCodesByRoleId(@Param("roleId") UUID roleId);

    @Modifying(flushAutomatically = true, clearAutomatically = false)
    @Query("delete from RolePermission rp where rp.role.id = :roleId")
    int deleteByRoleId(@Param("roleId") UUID roleId);
}
