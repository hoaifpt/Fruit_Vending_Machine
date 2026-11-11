package com.fruitmachine.backend.security.user;

import com.fruitmachine.backend.user.entity.Role;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.entity.UserRole;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthorityMappingTest {
    @Mock UserRepository users;
    @InjectMocks CustomUserDetailsService details;

    User user(String... roleNames) {
        User user = new User();
        ReflectionTestUtils.setField(user, "id", UUID.randomUUID());
        user.setEmail("mapping-test@example.invalid");
        user.setFullName("Test-only user");
        user.setPasswordHash("opaque-test-only-hash");
        for (String name : roleNames) {
            Role role = new Role();
            ReflectionTestUtils.setField(role, "id", UUID.randomUUID());
            role.setName(name);
            UserRole membership = new UserRole();
            membership.setUser(user);
            membership.setRole(role);
            user.getRoleMemberships().add(membership);
        }
        return user;
    }

    AuthenticatedUser load(User user) {
        when(users.findWithRolesByEmail(user.getEmail())).thenReturn(Optional.of(user));
        return details.loadUserByUsername("  MAPPING-TEST@EXAMPLE.INVALID  ");
    }

    @ParameterizedTest
    @ValueSource(strings = {"ADMIN", "STAFF"})
    void mapsEachRoleWithoutAddingAnImplicitHierarchy(String role) {
        var principal = load(user(role));
        assertThat(principal.getAuthorities()).extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_" + role);
        verify(users).findWithRolesByEmail("mapping-test@example.invalid");
    }

    @Test
    void multipleRolesAreExposedThroughUserDetails() {
        User user = user("ADMIN", "STAFF");
        var principal = load(user);
        assertThat(principal.getId()).isEqualTo(user.getId());
        assertThat(principal.getAuthorities()).extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_ADMIN", "ROLE_STAFF");
    }

    @Test
    void duplicateAuthorityNamesAreDeduplicatedByExistingPrincipal() {
        // Defensive in-memory fixture; real DB already prevents duplicate memberships/names.
        var principal = load(user("ADMIN", "STAFF", "ADMIN", "STAFF"));
        assertThat(principal.getAuthorities()).extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_ADMIN", "ROLE_STAFF");
    }

    @Test
    void userWithoutRolesDoesNotReceiveAnyInventedAuthority() {
        assertThat(load(user()).getAuthorities()).isEmpty();
    }

    @Test
    void uuidLookupUsesTheSameExistingMapping() {
        User user = user("STAFF");
        when(users.findWithRolesById(user.getId())).thenReturn(Optional.of(user));
        var principal = details.loadUserById(user.getId());
        assertThat(principal.getId()).isEqualTo(user.getId());
        assertThat(principal.getAuthorities()).extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_STAFF");
    }

    @ParameterizedTest
    @EnumSource(UserStatus.class)
    void roleMappingDoesNotBypassExistingAccountStatus(UserStatus status) {
        User user = user("ADMIN");
        user.setStatus(status);
        var principal = load(user);
        assertThat(principal.isEnabled()).isEqualTo(status == UserStatus.ACTIVE);
        assertThat(principal.isAccountNonLocked()).isEqualTo(status != UserStatus.LOCKED);
    }
}
