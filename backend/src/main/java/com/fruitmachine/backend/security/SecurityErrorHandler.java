package com.fruitmachine.backend.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.common.response.ApiErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class SecurityErrorHandler {
    private final ObjectMapper mapper;

    public AuthenticationEntryPoint entryPoint() {
        return (request, response, exception) -> write(request, response, HttpStatus.UNAUTHORIZED,
                "Authentication required or access token invalid");
    }

    public AccessDeniedHandler accessDeniedHandler() {
        return (request, response, exception) -> write(request, response, HttpStatus.FORBIDDEN, "Access denied");
    }

    private void write(HttpServletRequest request, HttpServletResponse response, HttpStatus status,
            String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Cache-Control", "no-store");
        if (status == HttpStatus.UNAUTHORIZED) {
            response.setHeader("WWW-Authenticate", "Bearer");
        }
        mapper.writeValue(response.getOutputStream(), new ApiErrorResponse(Instant.now(), status.value(),
                status.getReasonPhrase(), message, request.getRequestURI(), Map.of()));
    }
}
