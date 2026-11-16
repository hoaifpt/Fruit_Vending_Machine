package com.fruitmachine.backend.security.user;

import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {
    public static final String ROLE_PREFIX = "ROLE_";
    private final UserRepository users;

    @Override
    @Transactional(readOnly = true)
    public AuthenticatedUser loadUserByUsername(String email) {
        return principal(users.findWithAuthoritiesByEmail(email.strip().toLowerCase(Locale.ROOT))
                .orElseThrow(() -> new UsernameNotFoundException("Invalid email or password")));
    }

    @Transactional(readOnly = true)
    public AuthenticatedUser loadUserById(UUID id) {
        return principal(users.findWithAuthoritiesById(id)
                .orElseThrow(() -> new UsernameNotFoundException("Authentication required")));
    }

    /**
     * Authorities = ROLE_<name> for each role + the permission codes of those roles. Loaded from the database on every request,
     * so a role permission change applies to the user's next request with the same JWT. Spring's User keeps them sorted by name.
     */
    private AuthenticatedUser principal(User user) {
        var authorities = new java.util.TreeSet<String>();
        for (var role : user.getRoles()) {
            authorities.add(ROLE_PREFIX + role.getName());
            role.getPermissions().forEach(permission -> authorities.add(permission.getCode()));
        }
        return new AuthenticatedUser(user.getId(), user.getEmail(), user.getPasswordHash(),
                user.getStatus(), authorities.stream().map(SimpleGrantedAuthority::new).toList());
    }
}
