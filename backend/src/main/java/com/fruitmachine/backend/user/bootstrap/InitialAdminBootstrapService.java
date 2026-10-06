package com.fruitmachine.backend.user.bootstrap;

import com.fruitmachine.backend.config.properties.InitialAdminProperties;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.entity.UserRole;
import com.fruitmachine.backend.user.enums.RoleName;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.repository.BootstrapLockRepository;
import com.fruitmachine.backend.user.repository.RoleRepository;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.user.repository.UserRoleRepository;
import com.fruitmachine.backend.user.service.AccountCredentialPolicy;
import java.util.ArrayList;
import java.util.List;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InitialAdminBootstrapService {
    private final UserRepository users;
    private final RoleRepository roles;
    private final UserRoleRepository memberships;
    private final BootstrapLockRepository lock;
    private final AccountCredentialPolicy credentials;
    private final PasswordEncoder encoder;

    public InitialAdminBootstrapService(UserRepository users, RoleRepository roles,
            UserRoleRepository memberships, BootstrapLockRepository lock,
            AccountCredentialPolicy credentials, PasswordEncoder encoder) {
        this.users = users;
        this.roles = roles;
        this.memberships = memberships;
        this.lock = lock;
        this.credentials = credentials;
        this.encoder = encoder;
    }

    /** Returns only after the proxied transaction commits; never returns an entity or secrets. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public boolean bootstrap(InitialAdminProperties properties) {
        lock.acquire();
        if (users.existsByRoleMemberships_Role_Name(RoleName.ADMIN.name())) {
            return false;
        }
        List<String> missing = new ArrayList<>();
        if (properties.email() == null || properties.email().isBlank()) missing.add("INITIAL_ADMIN_EMAIL");
        if (properties.password() == null || properties.password().isBlank()) missing.add("INITIAL_ADMIN_PASSWORD");
        if (!missing.isEmpty()) {
            throw new IllegalStateException("Initial admin bootstrap required: missing " + String.join(", ", missing));
        }
        String email;
        try {
            email = credentials.normalizeEmail(properties.email());
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("Initial admin bootstrap: INITIAL_ADMIN_EMAIL: " + ex.getMessage());
        }
        try {
            credentials.validateNewPassword(properties.password());
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("Initial admin bootstrap: INITIAL_ADMIN_PASSWORD: " + ex.getMessage());
        }
        String fullName = properties.fullName() == null || properties.fullName().isBlank()
                ? "Initial Administrator" : properties.fullName().strip();
        if (fullName.length() > 200) {
            throw new IllegalStateException("Initial admin bootstrap: INITIAL_ADMIN_FULL_NAME must be at most 200 characters");
        }
        var admin = roles.findByName(RoleName.ADMIN).orElseThrow(() -> new IllegalStateException(
                "Initial admin bootstrap failed: required ADMIN role does not exist; check Flyway role seeding"));
        if (users.existsByEmail(email)) {
            throw new IllegalStateException("Initial admin bootstrap conflict: INITIAL_ADMIN_EMAIL belongs to an existing account; no account was promoted");
        }
        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(encoder.encode(properties.password()));
        user.setFullName(fullName);
        user.setStatus(UserStatus.ACTIVE);
        user = users.saveAndFlush(user);
        UserRole membership = new UserRole();
        membership.setUser(user);
        membership.setRole(admin);
        memberships.saveAndFlush(membership);
        return true;
    }
}
