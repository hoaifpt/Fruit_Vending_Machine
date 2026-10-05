package com.fruitmachine.backend.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;

import static org.assertj.core.api.Assertions.*;

class SecurityErrorHandlerTest {
    private final ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());
    private final SecurityErrorHandler errors = new SecurityErrorHandler(mapper);

    @Test
    void entryPointReturnsCommon401WithoutExposingAuthenticationDetails() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/v1/test-only/protected");
        var response = new MockHttpServletResponse();
        errors.entryPoint().commence(request, response, new BadCredentialsException("sensitive-test-only-token-details"));
        assertError(response, 401, "Unauthorized", "Authentication required or access token invalid");
        assertThat(response.getHeader("WWW-Authenticate")).isEqualTo("Bearer");
    }

    @Test
    void accessDeniedHandlerReturnsCommon403WithoutMisclassifyingAsAuthenticationFailure() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/v1/test-only/protected");
        var response = new MockHttpServletResponse();
        errors.accessDeniedHandler().handle(request, response, new AccessDeniedException("sensitive-test-only-role-details"));
        assertError(response, 403, "Forbidden", "Access denied");
        assertThat(response.getHeader("WWW-Authenticate")).isNull();
    }

    private void assertError(MockHttpServletResponse response, int status, String error, String message) throws Exception {
        assertThat(response.getStatus()).isEqualTo(status);
        assertThat(response.getContentType()).startsWith("application/json");
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        var body = mapper.readTree(response.getContentAsString());
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("timestamp", "status", "error", "message", "path");
        assertThat(body.path("timestamp").isMissingNode()).isFalse();
        assertThat(body.path("status").asInt()).isEqualTo(status);
        assertThat(body.path("error").asText()).isEqualTo(error);
        assertThat(body.path("message").asText()).isEqualTo(message);
        assertThat(body.path("path").asText()).isEqualTo("/api/v1/test-only/protected");
        assertThat(response.getContentAsString()).doesNotContain("sensitive-test-only", "stackTrace", "credentials", "exception");
    }
}
