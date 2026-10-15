package com.fruitmachine.backend.security.kiosk;

import com.fruitmachine.backend.machine.kiosk.service.KioskCredentialService;
import com.fruitmachine.backend.security.SecurityErrorHandler;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates {@code X-Kiosk-Key} for /api/v1/kiosk/** only. A missing header is left to the
 * authorization rules (401 anonymous, 403 for a user JWT); any invalid key is a uniform 401.
 */
@RequiredArgsConstructor
public class KioskAuthenticationFilter extends OncePerRequestFilter {
    public static final String HEADER = "X-Kiosk-Key";
    private static final String BASE = "/api/v1/kiosk";
    private final KioskCredentialService credentials;
    private final SecurityErrorHandler errors;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !(path.equals(BASE) || path.startsWith(BASE + "/"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var headers = Collections.list(request.getHeaders(HEADER));
        if (headers.isEmpty()) {
            chain.doFilter(request, response);
            return;
        }
        // A request carrying both a user JWT and a kiosk key is ambiguous and rejected.
        Optional<AuthenticatedKiosk> kiosk = headers.size() == 1 && SecurityContextHolder.getContext().getAuthentication() == null
                ? credentials.authenticate(headers.getFirst()) : Optional.empty();
        if (kiosk.isEmpty()) {
            SecurityContextHolder.clearContext();
            errors.entryPoint().commence(request, response, new BadCredentialsException("Invalid kiosk credential"));
            return;
        }
        var authentication = UsernamePasswordAuthenticationToken.authenticated(kiosk.get(), null,
                List.of(new SimpleGrantedAuthority("ROLE_KIOSK")));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        chain.doFilter(request, response);
    }
}
