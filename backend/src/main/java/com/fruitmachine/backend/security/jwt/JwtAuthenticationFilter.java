package com.fruitmachine.backend.security.jwt;

import com.fruitmachine.backend.security.SecurityErrorHandler;
import com.fruitmachine.backend.security.user.CustomUserDetailsService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.filter.OncePerRequestFilter;

@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private static final Pattern BEARER = Pattern.compile("(?i)^Bearer ([A-Za-z0-9_.-]+)$");
    private final JwtService tokens;
    private final CustomUserDetailsService users;
    private final SecurityErrorHandler errors;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var headers = Collections.list(request.getHeaders("Authorization"));
        if (headers.isEmpty()) {
            chain.doFilter(request, response);
            return;
        }
        try {
            var match = BEARER.matcher(headers.getFirst());
            if (headers.size() != 1 || !match.matches()) {
                throw new BadCredentialsException("Invalid Authorization header");
            }
            var user = users.loadUserById(tokens.extractSubject(match.group(1)));
            if (!user.isEnabled() || !user.isAccountNonLocked()) {
                throw new BadCredentialsException("Account is unavailable");
            }
            user.eraseCredentials();
            var authentication = UsernamePasswordAuthenticationToken.authenticated(user, null, user.getAuthorities());
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            var context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            SecurityContextHolder.setContext(context);
        } catch (AuthenticationException ex) {
            SecurityContextHolder.clearContext();
            errors.entryPoint().commence(request, response, ex);
            return;
        }
        // Downstream failures are not token failures; let normal error handling process them.
        chain.doFilter(request, response);
    }
}
