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
    public OpenApiCustomizer orderedTags() {
        return api -> {
            if (api.getTags() != null) {
                api.setTags(api.getTags().stream().sorted(java.util.Comparator.comparing(io.swagger.v3.oas.models.tags.Tag::getName)).toList());
            }
        };
    }

    @Bean
    public OpenApiCustomizer userHeaders() {
        return api -> api.getPaths().forEach((name, path) -> {
            if (!name.startsWith("/api/v1/users")) return;
            path.readOperations().forEach(operation -> {
                operation.getResponses().forEach((code, response) -> {
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                    }
                    if (code.equals("401")) {
                        response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
                    }
                    if (code.equals("201")) {
                        response.addHeaderObject("Location", new Header().description("Relative URL of the created account.").schema(new StringSchema()));
                    }
                });
            });
        });
    }

    @Bean
    public OpenApiCustomizer userExamples() {
        return api -> api.getPaths().forEach((name, path) -> {
            if (!name.startsWith("/api/v1/users")) return;
            var user = Map.of("id", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a01", "email", "staff@example.com",
                    "fullName", "Nguyen Van A", "phone", "0901234567", "status", "ACTIVE", "roles", List.of("STAFF"),
                    "createdAt", "2026-10-06T00:00:00Z", "updatedAt", "2026-10-06T00:00:00Z");
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                if (operation.getRequestBody() != null) {
                    Map<String, String> example = switch (id) {
                        case "createStaff" -> Map.of("email", "staff@example.com", "password", "<new-staff-password>", "fullName", "Nguyen Van A", "phone", "0901234567");
                        case "updateUser" -> Map.of("fullName", "Nguyen Van B", "phone", "0912345678");
                        default -> Map.of("status", "INACTIVE");
                    };
                    operation.getRequestBody().getContent().get("application/json").setExample(example);
                }
                operation.getResponses().forEach((code, response) -> {
                    Object example;
                    if (code.startsWith("2")) {
                        Object data = switch (id) {
                            case "listUsers" -> Map.of("content", List.of(user), "page", 0, "size", 20, "totalElements", 1, "totalPages", 1);
                            case "updateUser" -> {
                                var updated = new java.util.HashMap<String, Object>(user);
                                updated.put("fullName", "Nguyen Van B");
                                updated.put("phone", "0912345678");
                                yield updated;
                            }
                            case "updateUserStatus" -> {
                                var updated = new java.util.HashMap<String, Object>(user);
                                updated.put("status", "INACTIVE");
                                yield updated;
                            }
                            default -> user;
                        };
                        String message = switch (id) {
                            case "listUsers" -> "Users retrieved";
                            case "createStaff" -> "STAFF account created";
                            case "updateUser" -> "User updated";
                            case "updateUserStatus" -> "User status updated";
                            default -> "User retrieved";
                        };
                        example = Map.of("timestamp", "2026-10-06T00:00:00Z", "message", message, "data", data);
                    } else {
                        String error = switch (code) {
                            case "400" -> "Bad Request";
                            case "401" -> "Unauthorized";
                            case "403" -> "Forbidden";
                            case "404" -> "Not Found";
                            case "409" -> "Conflict";
                            default -> "Internal Server Error";
                        };
                        String message = switch (code) {
                            case "400" -> "Request body is missing or malformed";
                            case "401" -> "Authentication required or access token invalid";
                            case "403" -> "Access denied";
                            case "404" -> "User not found";
                            case "409" -> id.equals("createStaff") ? "Email is already in use" : "You cannot disable or lock your own account";
                            default -> "An unexpected error occurred";
                        };
                        example = Map.of("timestamp", "2026-10-06T00:00:00Z", "status", Integer.parseInt(code), "error", error,
                                "message", message, "path", name);
                    }
                    response.getContent().get("application/json").setExample(example);
                });
            });
        });
    }

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
                        + "ADMIN/STAFF roles are independent. User Management requires ADMIN and creates STAFF accounts. No refresh tokens."))
                .components(new Components().addSecuritySchemes("bearerAuth", new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")
                        .description("Paste the access token only (without the Bearer prefix).")));
    }
}
