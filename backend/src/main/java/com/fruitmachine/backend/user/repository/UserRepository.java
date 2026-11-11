package com.fruitmachine.backend.user.repository;

import com.fruitmachine.backend.user.entity.User;
import java.util.Optional;
import java.util.UUID;
import java.util.Collection;
import java.util.List;
import com.fruitmachine.backend.user.enums.UserStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    boolean existsByRoleMemberships_Role_Name(String roleName);

    @EntityGraph(attributePaths = "roleMemberships.role")
    Optional<User> findWithRolesByEmail(String email);

    @EntityGraph(attributePaths = "roleMemberships.role")
    Optional<User> findWithRolesById(UUID id);

    // Page roots first: fetching a collection in this query would paginate in memory.
    @Query("""
            select u from User u
            where (:status is null or u.status = :status)
              and (:role is null or exists (
                select m from UserRole m where m.user = u and m.role.name = :role))
            """)
    Page<User> findFiltered(@Param("status") UserStatus status, @Param("role") String role, Pageable pageable);

    @EntityGraph(attributePaths = "roleMemberships.role")
    @Query("select u from User u where u.id in :ids")
    List<User> findAllWithRolesByIdIn(@Param("ids") Collection<UUID> ids);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from User u where u.id = :id")
    Optional<User> findForUpdateById(@Param("id") UUID id);

    long countByStatusAndRoleMemberships_Role_Name(UserStatus status, String roleName);
}
