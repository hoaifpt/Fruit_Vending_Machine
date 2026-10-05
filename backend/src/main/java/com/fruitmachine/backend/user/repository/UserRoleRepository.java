package com.fruitmachine.backend.user.repository;

import com.fruitmachine.backend.user.entity.UserRole;
import com.fruitmachine.backend.user.entity.UserRoleId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRoleRepository extends JpaRepository<UserRole, UserRoleId> {
}
