package com.fruitmachine.backend.security.jwt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.security.SecurityErrorHandler;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.security.user.CustomUserDetailsService;
import com.fruitmachine.backend.user.enums.UserStatus;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class JwtAuthenticationFilterTest {
    final String key = JwtServiceTest.newKey();
    final JwtService tokens = new JwtService(new JwtProperties(key, 3600), JwtServiceTest.CLOCK);
    final CustomUserDetailsService users = mock(CustomUserDetailsService.class);
    final JwtAuthenticationFilter filter = new JwtAuthenticationFilter(tokens, users,
            new SecurityErrorHandler(new ObjectMapper().findAndRegisterModules()));
    final AuthenticatedUser user = new AuthenticatedUser(UUID.randomUUID(), "test@example.com", "secret-hash",
            UserStatus.ACTIVE, List.of());

    @AfterEach
    void clearContext() { SecurityContextHolder.clearContext(); }

    @Test
    void validBearerEstablishesAuthenticationWithNoCredentials() throws Exception {
        when(users.loadUserById(user.getId())).thenReturn(user);
        var request = new MockHttpServletRequest();
        request.addHeader("Authorization", "bEaReR " + tokens.generateToken(user));
        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> {
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            assertThat(authentication.isAuthenticated()).isTrue();
            assertThat(authentication.getPrincipal()).isSameAs(user);
            assertThat(authentication.getCredentials()).isNull();
            assertThat(user.getPassword()).isNull();
        });
        verify(users).loadUserById(user.getId());
    }

    @Test
    void missingHeaderContinuesWithoutAuthentication() throws Exception {
        var chain = mock(jakarta.servlet.FilterChain.class);
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, chain);
        verify(chain).doFilter(request, response);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verifyNoInteractions(users);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "Bearer", "Bearer ", "Bearer a.b.c", "Basic abc", "Bearer  abc", "Bearer abc def"})
    void malformedOrInvalidHeaderReturnsSafe401WithoutAuthentication(String header) throws Exception {
        rejected(header);
    }

    @Test
    void expiredTokenNeverLoadsUserOrPopulatesContext() throws Exception {
        var earlier = new JwtService(new JwtProperties(key, 1),
                Clock.fixed(JwtServiceTest.NOW.minusSeconds(2), ZoneOffset.UTC));
        rejected("Bearer " + earlier.generateToken(user));
        verifyNoInteractions(users);
    }

    private void rejected(String header) throws Exception {
        var request = new MockHttpServletRequest();
        request.addHeader("Authorization", header);
        var response = new MockHttpServletResponse();
        var chain = mock(jakarta.servlet.FilterChain.class);
        filter.doFilter(request, response, chain);
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("Unauthorized").doesNotContain("secret-hash");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verifyNoInteractions(chain);
    }
}
