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
    private final UserRepository users;

    @Override
    @Transactional(readOnly = true)
    public AuthenticatedUser loadUserByUsername(String email) {
        return principal(users.findWithRolesByEmail(email.strip().toLowerCase(Locale.ROOT))
                .orElseThrow(() -> new UsernameNotFoundException("Invalid email or password")));
    }

    @Transactional(readOnly = true)
    public AuthenticatedUser loadUserById(UUID id) {
        return principal(users.findWithRolesById(id)
                .orElseThrow(() -> new UsernameNotFoundException("Authentication required")));
    }

    private AuthenticatedUser principal(User user) {
        var authorities = user.getRoles().stream()
                .map(role -> new SimpleGrantedAuthority("ROLE_" + role.getName())).toList();
        return new AuthenticatedUser(user.getId(), user.getEmail(), user.getPasswordHash(),
                user.getStatus(), authorities);
    }
}
