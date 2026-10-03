package com.fruitmachine.backend.auth.service;

import com.fruitmachine.backend.auth.dto.LoginRequest;
import com.fruitmachine.backend.auth.dto.LoginResponse;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.security.jwt.JwtService;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {
    private final AuthenticationManager authenticationManager;
    private final JwtService tokens;

    public LoginResponse login(LoginRequest request) {
        if (request.password().getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new BadRequestException("Password must not exceed 72 UTF-8 bytes");
        }
        var authentication = authenticationManager.authenticate(
                UsernamePasswordAuthenticationToken.unauthenticated(request.email(), request.password()));
        var user = (AuthenticatedUser) authentication.getPrincipal();
        return new LoginResponse(tokens.generateToken(user), "Bearer", tokens.expirationSeconds());
    }
}
