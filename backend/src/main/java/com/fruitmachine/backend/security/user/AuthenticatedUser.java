package com.fruitmachine.backend.security.user;

import com.fruitmachine.backend.user.enums.UserStatus;
import java.util.Collection;
import java.util.UUID;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.User;

public final class AuthenticatedUser extends User {
    private final UUID id;

    public AuthenticatedUser(UUID id, String email, String passwordHash, UserStatus status,
            Collection<? extends GrantedAuthority> authorities) {
        super(email, passwordHash, status == UserStatus.ACTIVE, true, true,
                status != UserStatus.LOCKED, authorities);
        this.id = id;
    }

    public UUID getId() {
        return id;
    }
}
