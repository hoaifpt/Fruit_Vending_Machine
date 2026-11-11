package com.fruitmachine.backend.user.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.dto.*;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.entity.UserRole;
import com.fruitmachine.backend.user.enums.RoleName;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.mapper.UserMapper;
import com.fruitmachine.backend.user.repository.*;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class UserService {
    private final UserRepository users;
    private final RoleRepository roles;
    private final UserRoleRepository memberships;
    private final UserStatusLockRepository statusLock;
    private final AccountCredentialPolicy credentials;
    private final PasswordEncoder encoder;
    private final UserMapper mapper;

    @Transactional(readOnly = true)
    public UserPageResponse listUsers(int page, int size, UserStatus status, RoleName role) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BadRequestException("Page must be nonnegative and size must be between 1 and 100");
        }
        var result = users.findFiltered(status, role == null ? null : role.name(),
                PageRequest.of(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"))));
        Map<UUID, User> fetched = result.isEmpty() ? Map.of() : users.findAllWithRolesByIdIn(
                result.getContent().stream().map(User::getId).toList()).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        return new UserPageResponse(result.getContent().stream().map(user -> mapper.toResponse(fetched.get(user.getId()))).toList(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public UserResponse getUser(UUID id) {
        return mapper.toResponse(users.findWithRolesById(id).orElseThrow(() -> notFound()));
    }

    @Transactional
    public UserResponse createStaff(CreateUserRequest request) {
        String email;
        try {
            email = credentials.normalizeEmail(request.email());
            credentials.validateNewPassword(request.password());
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException(ex.getMessage());
        }
        if (users.existsByEmail(email)) {
            throw new ConflictException("Email is already in use");
        }
        var staff = roles.findByName(RoleName.STAFF).orElseThrow(() -> new IllegalStateException("Required STAFF role is missing"));
        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(encoder.encode(request.password()));
        user.setFullName(request.fullName().strip());
        user.setPhone(request.phone());
        user.setStatus(UserStatus.ACTIVE);
        users.saveAndFlush(user);
        UserRole membership = new UserRole();
        membership.setUser(user);
        membership.setRole(staff);
        memberships.saveAndFlush(membership);
        user.getRoleMemberships().add(membership);
        return mapper.toResponse(user);
    }

    @Transactional
    public UserResponse updateUser(UUID id, UpdateUserRequest request) {
        User user = users.findForUpdateById(id).orElseThrow(() -> notFound());
        user.setFullName(request.fullName().strip());
        user.setPhone(request.phone());
        users.flush();
        return mapper.toResponse(user);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public UserResponse updateStatus(UUID id, UpdateUserStatusRequest request) {
        // Read actor from trusted security context, not a caller-provided UUID; suitable for future audit events.
        var principal = (AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        statusLock.acquire();
        var actor = users.findWithRolesById(principal.getId()).orElseThrow(() -> new AccessDeniedException("Access denied"));
        if (actor.getStatus() != UserStatus.ACTIVE) {
            throw new AccessDeniedException("Access denied");
        }
        User user = users.findForUpdateById(id).orElseThrow(() -> notFound());
        if (request.status() != UserStatus.ACTIVE) {
            if (id.equals(principal.getId())) {
                throw new ConflictException("You cannot disable or lock your own account");
            }
            if (user.getStatus() == UserStatus.ACTIVE
                    && user.getRoles().stream().anyMatch(role -> role.getName().equals(RoleName.ADMIN.name()))
                    && users.countByStatusAndRoleMemberships_Role_Name(UserStatus.ACTIVE, RoleName.ADMIN.name()) <= 1) {
                throw new ConflictException("The last active administrator cannot be disabled or locked");
            }
        }
        user.setStatus(request.status());
        users.flush();
        return mapper.toResponse(user);
    }

    private ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("User not found");
    }
}
