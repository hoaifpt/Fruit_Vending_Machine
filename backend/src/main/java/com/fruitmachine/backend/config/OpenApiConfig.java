package com.fruitmachine.backend.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springdoc.core.customizers.OpenApiCustomizer;
import io.swagger.v3.oas.models.headers.Header;
import io.swagger.v3.oas.models.media.StringSchema;
import java.util.Map;
import java.util.List;

@Configuration(proxyBeanMethods = false)
public class OpenApiConfig {
    @Bean
    public OpenApiCustomizer authExamples() {
        return api -> {
            var path = api.getPaths().get("/api/v1/auth/login");
            if (path == null || path.getPost() == null) {
                return;
            }
            var operation = path.getPost();
            operation.setSecurity(List.of());
            operation.getRequestBody().getContent().get("application/json")
                    .setExample(Map.of("email", "developer@example.com", "password", "<your-account-password>"));
            var success = operation.getResponses().get("200");
            success.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
            success.addHeaderObject("Pragma", new Header().schema(new StringSchema()._const("no-cache")));
            success.getContent().get("application/json").setExample(Map.of("timestamp", "2026-10-03T00:00:00Z",
                    "message", "Login successful", "data", Map.of("accessToken", "<access-token>", "tokenType", "Bearer", "expiresIn", 3600)));
            operation.getResponses().get("400").getContent().get("application/json").setExample(Map.of(
                    "timestamp", "2026-10-03T00:00:00Z", "status", 400, "error", "Validation Failed",
                    "message", "Request validation failed", "path", "/api/v1/auth/login",
                    "fieldErrors", Map.of("email", "must be a well-formed email address")));
            var unauthorized = operation.getResponses().get("401");
            unauthorized.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
            unauthorized.getContent().get("application/json").setExample(Map.of("timestamp", "2026-10-03T00:00:00Z",
                    "status", 401, "error", "Unauthorized", "message", "Invalid email or password", "path", "/api/v1/auth/login"));
        };
    }

    @Bean
    public OpenAPI backendOpenApi() {
        return new OpenAPI().info(new Info().title("Fruit Machine Backend API").version("v1")
                .description("Management API. Login is public; other application endpoints require Bearer authentication. "
                        + "No refresh tokens or ADMIN/STAFF endpoint policies yet."))
                .components(new Components().addSecuritySchemes("bearerAuth", new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")
                        .description("Paste the access token only (without the Bearer prefix).")));
    }
}
