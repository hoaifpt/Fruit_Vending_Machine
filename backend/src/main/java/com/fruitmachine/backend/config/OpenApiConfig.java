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
    public OpenApiCustomizer productDocumentation() {
        return api -> api.getPaths().forEach((name, path) -> {
            if (!name.startsWith("/api/v1/products")) return;
            var product = Map.of("id", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a02", "sku", "MANGO-BOX-001",
                    "name", "Mango Fruit Box", "description", "Fresh prepared mango", "price", new java.math.BigDecimal("35000.00"),
                    "imageUrl", "https://example.com/products/mango.jpg", "status", "ACTIVE",
                    "createdAt", "2026-10-06T00:00:00Z", "updatedAt", "2026-10-06T00:00:00Z");
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                if (operation.getRequestBody() != null) {
                    var fields = new java.util.HashMap<String, Object>();
                    if (id.equals("updateProductStatus")) fields.put("status", "INACTIVE");
                    else {
                        fields.put("name", id.equals("updateProduct") ? "Updated Mango Fruit Box" : "Mango Fruit Box");
                        fields.put("description", "Fresh prepared mango");
                        fields.put("price", new java.math.BigDecimal("35000.00"));
                        fields.put("imageUrl", "https://example.com/products/mango.jpg");
                        if (id.equals("createProduct")) fields.put("sku", "MANGO-BOX-001");
                    }
                    operation.getRequestBody().getContent().get("application/json").setExample(fields);
                }
                operation.getResponses().forEach((code, response) -> {
                    Object example;
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                        if (code.equals("201")) response.addHeaderObject("Location", new Header()
                                .description("Relative URL of the created product.").schema(new StringSchema()));
                        var updated = new java.util.HashMap<String, Object>(product);
                        if (id.equals("updateProductStatus")) updated.put("status", "INACTIVE");
                        if (id.equals("updateProduct")) updated.put("name", "Updated Mango Fruit Box");
                        Object data = id.equals("listProducts") ? Map.of("content", List.of(product), "page", 0, "size", 20,
                                "totalElements", 1, "totalPages", 1) : updated;
                        String message = switch (id) {
                            case "listProducts" -> "Products retrieved";
                            case "createProduct" -> "Product created";
                            case "updateProduct" -> "Product updated";
                            case "updateProductStatus" -> "Product status updated";
                            default -> "Product retrieved";
                        };
                        example = Map.of("timestamp", "2026-10-06T00:00:00Z", "message", message, "data", data);
                    } else {
                        if (code.equals("401")) response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
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
                            case "404" -> "Product not found";
                            case "409" -> "SKU is already in use";
                            default -> "An unexpected error occurred";
                        };
                        example = Map.of("timestamp", "2026-10-06T00:00:00Z", "status", Integer.parseInt(code),
                                "error", error, "message", message, "path", name);
                    }
                    response.getContent().get("application/json").setExample(example);
                });
            });
        });
    }
    @Bean
    public OpenApiCustomizer machineDocumentation() {
        return api -> api.getPaths().forEach((name, path) -> {
            if (!java.util.Set.of("/api/v1/machines", "/api/v1/machines/{id}", "/api/v1/machines/{id}/status").contains(name)) return;
            var machine = new java.util.HashMap<String, Object>();
            machine.put("id", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a03");
            machine.put("code", "FV-HCM-001");
            machine.put("name", "Fruit Machine - Campus A");
            machine.put("location", "Building A - Ground Floor");
            machine.put("status", "INACTIVE");
            machine.put("minTemperature", new java.math.BigDecimal("2.00"));
            machine.put("maxTemperature", new java.math.BigDecimal("8.00"));
            machine.put("minHumidity", new java.math.BigDecimal("40.00"));
            machine.put("maxHumidity", new java.math.BigDecimal("80.00"));
            machine.put("lastSeenAt", null);
            machine.put("createdAt", "2026-10-10T00:00:00Z");
            machine.put("updatedAt", "2026-10-10T00:00:00Z");
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                if (operation.getRequestBody() != null) {
                    var fields = new java.util.HashMap<String, Object>();
                    if (id.equals("updateMachineStatus")) fields.put("status", "MAINTENANCE");
                    else {
                        fields.put("name", id.equals("updateMachine") ? "Updated Campus Machine" : "Fruit Machine - Campus A");
                        fields.put("location", "Building A - Ground Floor");
                        fields.put("minTemperature", new java.math.BigDecimal("2.00"));
                        fields.put("maxTemperature", new java.math.BigDecimal("8.00"));
                        fields.put("minHumidity", new java.math.BigDecimal("40.00"));
                        fields.put("maxHumidity", new java.math.BigDecimal("80.00"));
                        if (id.equals("createMachine")) fields.put("code", "FV-HCM-001");
                    }
                    operation.getRequestBody().getContent().get("application/json").setExample(fields);
                }
                operation.getResponses().forEach((code, response) -> {
                    Object example;
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                        if (code.equals("201")) response.addHeaderObject("Location", new Header()
                                .description("Relative URL of the created machine.").schema(new StringSchema()));
                        var updated = new java.util.HashMap<String, Object>(machine);
                        if (id.equals("updateMachineStatus")) updated.put("status", "MAINTENANCE");
                        if (id.equals("updateMachine")) updated.put("name", "Updated Campus Machine");
                        Object data = id.equals("listMachines") ? Map.of("content", List.of(machine), "page", 0, "size", 20,
                                "totalElements", 1, "totalPages", 1) : updated;
                        String message = switch (id) {
                            case "listMachines" -> "Machines retrieved";
                            case "createMachine" -> "Machine created";
                            case "updateMachine" -> "Machine updated";
                            case "updateMachineStatus" -> "Machine status updated";
                            default -> "Machine retrieved";
                        };
                        example = Map.of("timestamp", "2026-10-10T00:00:00Z", "message", message, "data", data);
                    } else {
                        if (code.equals("401")) response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
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
                            case "404" -> "Machine not found";
                            case "409" -> "Machine code is already in use";
                            default -> "An unexpected error occurred";
                        };
                        example = Map.of("timestamp", "2026-10-10T00:00:00Z", "status", Integer.parseInt(code),
                                "error", error, "message", message, "path", name);
                    }
                    response.getContent().get("application/json").setExample(example);
                });
            });
        });
    }
    @Bean
    public OpenApiCustomizer machineSlotDocumentation() {
        return api -> api.getPaths().forEach((name, path) -> {
            if (!name.startsWith("/api/v1/machines/") || !name.contains("/slots")) return;
            var slot = Map.of("id", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a04",
                    "machineId", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a03", "slotCode", "A1", "capacity", 6, "status", "ACTIVE",
                    "createdAt", "2026-10-10T00:00:00Z", "updatedAt", "2026-10-10T00:00:00Z");
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                if (operation.getRequestBody() != null) {
                    Object request = switch (id) {
                        case "createMachineSlot" -> Map.of("slotCode", "A1", "capacity", 6);
                        case "updateMachineSlot" -> Map.of("capacity", 8);
                        default -> Map.of("status", "INACTIVE");
                    };
                    operation.getRequestBody().getContent().get("application/json").setExample(request);
                }
                operation.getResponses().forEach((code, response) -> {
                    Object example;
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                        if (code.equals("201")) response.addHeaderObject("Location", new Header()
                                .description("Relative machine-scoped URL of the created slot.").schema(new StringSchema()));
                        var updated = new java.util.HashMap<String, Object>(slot);
                        if (id.equals("updateMachineSlot")) updated.put("capacity", 8);
                        if (id.equals("updateMachineSlotStatus")) updated.put("status", "INACTIVE");
                        Object data = id.equals("listMachineSlots") ? Map.of("content", List.of(slot), "page", 0, "size", 20,
                                "totalElements", 1, "totalPages", 1) : updated;
                        String message = switch (id) {
                            case "listMachineSlots" -> "Machine slots retrieved";
                            case "createMachineSlot" -> "Machine slot created";
                            case "updateMachineSlot" -> "Machine slot updated";
                            case "updateMachineSlotStatus" -> "Machine slot status updated";
                            default -> "Machine slot retrieved";
                        };
                        example = Map.of("timestamp", "2026-10-10T00:00:00Z", "message", message, "data", data);
                    } else {
                        if (code.equals("401")) response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
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
                            case "404" -> "Slot not found in specified machine";
                            case "409" -> "Slot code is already in use for this machine";
                            default -> "An unexpected error occurred";
                        };
                        example = Map.of("timestamp", "2026-10-10T00:00:00Z", "status", Integer.parseInt(code),
                                "error", error, "message", message, "path", name);
                    }
                    response.getContent().get("application/json").setExample(example);
                });
            });
        });
    }
    @Bean
    public OpenApiCustomizer productBatchDocumentation() {
        return api -> api.getPaths().forEach((name, path) -> {
            if (!name.equals("/api/v1/product-batches") && !name.equals("/api/v1/product-batches/{id}")) return;
            var batch = Map.of("id", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a05", "batchCode", "MANGO-20261010-01",
                    "productId", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a02", "productSku", "MANGO-BOX-001", "productName", "Mango Fruit Box",
                    "manufacturedAt", "2026-10-10T01:00:00Z", "expiresAt", "2026-10-12T01:00:00Z", "quantity", 20,
                    "createdBy", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a01", "createdAt", "2026-10-10T02:00:00Z");
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                if (operation.getRequestBody() != null) operation.getRequestBody().getContent().get("application/json")
                        .setExample(Map.of("batchCode", batch.get("batchCode"), "productId", batch.get("productId"),
                                "manufacturedAt", batch.get("manufacturedAt"), "expiresAt", batch.get("expiresAt"), "quantity", 20));
                operation.getResponses().forEach((code, response) -> {
                    Object example;
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                        if (code.equals("201")) response.addHeaderObject("Location", new Header().description("Relative URL of the created batch.").schema(new StringSchema()));
                        Object data = id.equals("listProductBatches") ? Map.of("content", List.of(batch), "page", 0, "size", 20, "totalElements", 1, "totalPages", 1) : batch;
                        String message = switch (id) {
                            case "createProductBatch" -> "Product batch created";
                            case "listProductBatches" -> "Product batches retrieved";
                            default -> "Product batch retrieved";
                        };
                        example = Map.of("timestamp", "2026-10-10T02:00:00Z", "message", message, "data", data);
                    } else {
                        if (code.equals("401")) response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
                        String error = switch (code) {
                            case "400" -> "Bad Request"; case "401" -> "Unauthorized"; case "403" -> "Forbidden";
                            case "404" -> "Not Found"; case "409" -> "Conflict"; default -> "Internal Server Error";
                        };
                        String message = switch (code) {
                            case "400" -> "Request body is missing or malformed";
                            case "401" -> "Authentication required or access token invalid"; case "403" -> "Access denied";
                            case "404" -> id.equals("createProductBatch") ? "Product not found" : "Product batch not found";
                            case "409" -> "Batch code is already in use"; default -> "An unexpected error occurred";
                        };
                        example = Map.of("timestamp", "2026-10-10T02:00:00Z", "status", Integer.parseInt(code), "error", error, "message", message, "path", name);
                    }
                    response.getContent().get("application/json").setExample(example);
                });
            });
        });
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
