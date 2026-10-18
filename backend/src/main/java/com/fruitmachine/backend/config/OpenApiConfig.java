package com.fruitmachine.backend.config;

import com.fruitmachine.backend.order.service.OrderReservationService;
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
            if (!List.of("/api/v1/machines/{machineId}/slots", "/api/v1/machines/{machineId}/slots/{slotId}",
                    "/api/v1/machines/{machineId}/slots/{slotId}/status").contains(name)) return;
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
    public OpenApiCustomizer inventoryDocumentation() {
        return api -> api.getPaths().forEach((name, path) -> {
            if (!name.startsWith("/api/v1/inventory") && !name.endsWith("/inventory") && !name.endsWith("/inventory/summary")) return;
            String itemId = "c6a33ea7-0c1c-4bbf-a890-3b7286d10a06", batchId = "c6a33ea7-0c1c-4bbf-a890-3b7286d10a05";
            String machineId = "c6a33ea7-0c1c-4bbf-a890-3b7286d10a03", slotId = "c6a33ea7-0c1c-4bbf-a890-3b7286d10a04";
            String operationId = "c6a33ea7-0c1c-4bbf-a890-3b7286d10a07", timestamp = "2026-10-10T02:00:00Z";
            var item = Map.ofEntries(Map.entry("id", itemId), Map.entry("batchId", batchId), Map.entry("batchCode", "MANGO-20261010-01"),
                    Map.entry("productId", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a02"), Map.entry("productName", "Mango Fruit Box"),
                    Map.entry("machineId", machineId), Map.entry("slotId", slotId), Map.entry("slotCode", "A1"), Map.entry("status", "AVAILABLE"),
                    Map.entry("expiresAt", "2026-10-12T01:00:00Z"), Map.entry("expired", false), Map.entry("loadedAt", timestamp), Map.entry("createdAt", timestamp), Map.entry("updatedAt", timestamp));
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                if (operation.getRequestBody() != null) operation.getRequestBody().getContent().get("application/json").setExample(
                        id.equals("loadInventory") ? Map.of("batchId", batchId, "slotId", slotId, "quantity", 1) : Map.of("reason", "Expired fruit removed during maintenance"));
                operation.getResponses().forEach((code, response) -> {
                    Object example;
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                        Object data;
                        if (id.equals("loadInventory")) data = Map.of("operationId", operationId, "quantity", 1, "items", List.of(item));
                        else if (id.equals("removeInventory")) { var removed = new java.util.HashMap<String, Object>(item); removed.put("status", "REMOVED"); removed.put("removedAt", timestamp); data = removed; }
                        else if (id.equals("getSlotInventorySummary")) data = Map.of("machineId", machineId, "slotId", slotId, "capacity", 6,
                                "occupiedCount", 1, "availableCount", 1, "expiredCount", 0, "reservedCount", 0, "sellableCount", 1, "remainingCapacity", 5, "asOf", timestamp);
                        else if (id.equals("getInventory")) data = item;
                        else {
                            Object entry = item;
                            if (id.equals("listInventoryTransactions")) entry = Map.ofEntries(Map.entry("id", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a08"),
                                    Map.entry("inventoryItemId", itemId), Map.entry("batchId", batchId), Map.entry("batchCode", "MANGO-20261010-01"), Map.entry("machineId", machineId),
                                    Map.entry("slotId", slotId), Map.entry("type", "LOAD"), Map.entry("referenceId", operationId), Map.entry("statusAfter", "AVAILABLE"),
                                    Map.entry("performedBy", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a01"), Map.entry("createdAt", timestamp));
                            data = Map.of("content", List.of(entry), "page", 0, "size", 20, "totalElements", 1, "totalPages", 1);
                        }
                        String message = switch (id) {
                            case "loadInventory" -> "Inventory loaded"; case "removeInventory" -> "Inventory removed";
                            case "getInventory" -> "Inventory item retrieved"; case "listMachineInventory" -> "Machine inventory retrieved";
                            case "listSlotInventory" -> "Slot inventory retrieved"; case "getSlotInventorySummary" -> "Inventory summary retrieved";
                            case "listInventoryTransactions" -> "Inventory transactions retrieved"; default -> "Inventory retrieved";
                        };
                        example = Map.of("timestamp", timestamp, "message", message, "data", data);
                    } else {
                        if (code.equals("401")) response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
                        String error = switch (code) { case "400" -> "Bad Request"; case "401" -> "Unauthorized"; case "403" -> "Forbidden"; case "404" -> "Not Found"; case "409" -> "Conflict"; default -> "Internal Server Error"; };
                        String message = switch (code) { case "400" -> "Request body is missing or malformed"; case "401" -> "Authentication required or access token invalid";
                            case "403" -> "Access denied"; case "404" -> "Inventory item not found"; case "409" -> "Slot capacity exceeded"; default -> "An unexpected error occurred"; };
                        if (code.equals("409") && id.equals("removeInventory")) message = "Only AVAILABLE or EXPIRED items may be removed; other states require reconciliation";
                        example = Map.of("timestamp", timestamp, "status", Integer.parseInt(code), "error", error, "message", message, "path", name);
                    }
                    response.getContent().get("application/json").setExample(example);
                });
            });
        });
    }
    @Bean
    public OpenApiCustomizer orderManagementExamples() {
        String timestamp = "2026-10-15T04:00:00Z";
        var line = Map.of("productId", "1c2d3e4f-0000-4000-8000-000000000001", "sku", "BOWL-MIX", "productName", "Mixed Fruit Bowl",
                "quantity", 1, "unitPrice", 35000.00, "totalPrice", 35000.00);
        var order = new java.util.LinkedHashMap<String, Object>();
        order.put("id", "e0f1a2b3-0000-4000-8000-000000000001"); order.put("orderCode", "ORD-20261015-7K3QF9XA");
        order.put("machineId", "9b1e0000-0000-4000-8000-000000000001"); order.put("status", "PENDING_PAYMENT");
        order.put("items", List.of(line)); order.put("subtotal", 35000.00); order.put("totalAmount", 35000.00);
        order.put("createdAt", timestamp); order.put("expiresAt", "2026-10-15T04:05:00Z"); order.put("cancelledAt", null);
        order.put("currentPayment", null);
        var cancelled = new java.util.LinkedHashMap<>(order);
        cancelled.put("status", "CANCELLED"); cancelled.put("cancelledAt", "2026-10-15T04:01:00Z");
        var issued = Map.of("credentialId", "4f6c0000-0000-4000-8000-000000000001", "machineId", "9b1e0000-0000-4000-8000-000000000001",
                "keyPrefix", "a1b2c3d4e5f6", "apiKey", "fvk_a1b2c3d4e5f6_<shown-once>", "status", "ACTIVE", "createdAt", timestamp);
        var metadata = new java.util.LinkedHashMap<String, Object>();
        metadata.put("credentialId", "4f6c0000-0000-4000-8000-000000000001"); metadata.put("keyPrefix", "a1b2c3d4e5f6");
        metadata.put("status", "REVOKED"); metadata.put("createdAt", timestamp); metadata.put("createdBy", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a01");
        metadata.put("revokedAt", "2026-10-15T05:00:00Z"); metadata.put("revokedBy", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a01");
        var catalog = Map.of("machineId", "9b1e0000-0000-4000-8000-000000000001", "machineCode", "FV-HCM-001", "acceptingOrders", true,
                "products", List.of(Map.of("productId", "1c2d3e4f-0000-4000-8000-000000000001", "sku", "BOWL-MIX",
                        "name", "Mixed Fruit Bowl", "description", "Seasonal mixed fruit", "price", 35000.00,
                        "imageUrl", "https://example.com/mix.png", "availableQuantity", 3)));
        var identity = Map.of("machineId", "9b1e0000-0000-4000-8000-000000000001", "machineCode", "FV-HCM-001",
                "machineName", "Fruit Machine - Campus A", "machineStatus", "ACTIVE");
        var summary = new java.util.LinkedHashMap<String, Object>();
        summary.put("id", "e0f1a2b3-0000-4000-8000-000000000001"); summary.put("orderCode", "ORD-20261015-7K3QF9XA");
        summary.put("machineId", "9b1e0000-0000-4000-8000-000000000001"); summary.put("machineCode", "FV-HCM-001");
        summary.put("status", "PENDING_PAYMENT"); summary.put("itemCount", 1); summary.put("totalQuantity", 1); summary.put("totalAmount", 35000.00);
        summary.put("createdAt", timestamp); summary.put("expiresAt", "2026-10-15T04:05:00Z"); summary.put("cancelledAt", null);
        var allocation = new java.util.LinkedHashMap<String, Object>();
        allocation.put("id", "a110c000-0000-4000-8000-000000000001"); allocation.put("inventoryItemId", "1e000000-0000-4000-8000-000000000001");
        allocation.put("slotCode", "A1"); allocation.put("batchCode", "B20261014-01"); allocation.put("batchExpiresAt", "2026-10-17T00:00:00Z");
        allocation.put("status", "RELEASED"); allocation.put("releasedAt", "2026-10-15T04:01:00Z");
        var detailLine = new java.util.LinkedHashMap<String, Object>(line);
        detailLine.put("id", "01100000-0000-4000-8000-000000000001"); detailLine.put("allocations", List.of(allocation));
        var detail = new java.util.LinkedHashMap<String, Object>();
        detail.put("id", "e0f1a2b3-0000-4000-8000-000000000001"); detail.put("orderCode", "ORD-20261015-7K3QF9XA");
        detail.put("machineId", "9b1e0000-0000-4000-8000-000000000001"); detail.put("machineCode", "FV-HCM-001");
        detail.put("status", "CANCELLED"); detail.put("subtotal", 35000.00); detail.put("totalAmount", 35000.00);
        detail.put("createdAt", timestamp); detail.put("expiresAt", "2026-10-15T04:05:00Z"); detail.put("paidAt", null);
        detail.put("completedAt", null); detail.put("cancelledAt", "2026-10-15T04:01:00Z"); detail.put("items", List.of(detailLine));
        var paymentSummary = new java.util.LinkedHashMap<String, Object>();
        paymentSummary.put("id", "5d6e0000-0000-4000-8000-000000000001"); paymentSummary.put("provider", "MOCK"); paymentSummary.put("status", "EXPIRED");
        paymentSummary.put("amount", 35000.00); paymentSummary.put("createdAt", "2026-10-15T04:00:05Z"); paymentSummary.put("paidAt", null);
        paymentSummary.put("expiredAt", "2026-10-15T04:05:00Z");
        detail.put("payments", List.of(paymentSummary));
        return api -> api.getPaths().forEach((name, path) -> {
            boolean mine = name.startsWith("/api/v1/kiosk") || name.startsWith("/api/v1/orders") || name.contains("/kiosk-credentials");
            if (!mine || name.endsWith("/payments")) return;
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                if (operation.getRequestBody() != null) {
                    operation.getRequestBody().getContent().get("application/json").setExample(
                            Map.of("productId", "1c2d3e4f-0000-4000-8000-000000000001"));
                }
                operation.getResponses().forEach((code, response) -> {
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                    }
                    if (code.equals("401")) {
                        response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
                    }
                    if (response.getContent() == null || response.getContent().get("application/json") == null) return;
                    Object example;
                    if (code.startsWith("2")) {
                        Object data = switch (id) {
                            case "issueKioskCredential" -> issued;
                            case "listKioskCredentials" -> List.of(metadata);
                            case "revokeKioskCredential" -> metadata;
                            case "getKioskIdentity" -> identity;
                            case "getKioskCatalog" -> catalog;
                            case "createKioskOrder", "getKioskOrder" -> order;
                            case "cancelKioskOrder" -> cancelled;
                            case "listOrders" -> Map.of("content", List.of(summary), "page", 0, "size", 20, "totalElements", 1, "totalPages", 1);
                            default -> detail;
                        };
                        example = Map.of("timestamp", timestamp, "message", "Success", "data", data);
                    } else {
                        String error = switch (code) { case "400" -> "Bad Request"; case "401" -> "Unauthorized"; case "403" -> "Forbidden"; case "404" -> "Not Found"; case "409" -> "Conflict"; default -> "Internal Server Error"; };
                        String message = switch (code) { case "400" -> "Request validation failed"; case "401" -> "Authentication required or access token invalid";
                            case "403" -> "Access denied"; case "404" -> "Order not found"; case "409" -> OrderReservationService.NOT_AVAILABLE; default -> "An unexpected error occurred"; };
                        example = Map.of("timestamp", timestamp, "status", Integer.parseInt(code), "error", error, "message", message, "path", name);
                    }
                    response.getContent().get("application/json").setExample(example);
                });
            });
        });
    }
    @Bean
    public OpenApiCustomizer paymentExamples() {
        String timestamp = "2026-10-15T04:00:00Z";
        var kioskPayment = new java.util.LinkedHashMap<String, Object>();
        kioskPayment.put("paymentId", "5d6e0000-0000-4000-8000-000000000001"); kioskPayment.put("orderId", "e0f1a2b3-0000-4000-8000-000000000001");
        kioskPayment.put("provider", "MOCK"); kioskPayment.put("status", "PENDING"); kioskPayment.put("amount", 70000.00);
        kioskPayment.put("qrCode", "MOCK-QR|MOCK-8F3KQ2AB|70000.00"); kioskPayment.put("expiresAt", "2026-10-15T04:05:00Z");
        var item = new java.util.LinkedHashMap<String, Object>();
        item.put("id", "5d6e0000-0000-4000-8000-000000000001"); item.put("orderId", "e0f1a2b3-0000-4000-8000-000000000001");
        item.put("orderCode", "ORD-20261015-7K3QF9XA"); item.put("machineCode", "FV-HCM-001"); item.put("provider", "MOCK"); item.put("status", "PENDING");
        item.put("amount", 70000.00); item.put("paymentReference", "MOCK-8F3KQ2AB"); item.put("transactionId", null);
        item.put("createdAt", "2026-10-15T04:00:05Z"); item.put("paidAt", null); item.put("expiredAt", "2026-10-15T04:05:00Z");
        var detail = new java.util.LinkedHashMap<String, Object>(item);
        detail.put("qrCode", "MOCK-QR|MOCK-8F3KQ2AB|70000.00");
        return api -> api.getPaths().forEach((name, path) -> {
            if (!name.startsWith("/api/v1/payments") && !name.endsWith("/payments")) return;
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                operation.getResponses().forEach((code, response) -> {
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                    }
                    if (code.equals("401")) {
                        response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
                    }
                    if (response.getContent() == null || response.getContent().get("application/json") == null) return;
                    Object example;
                    if (code.startsWith("2")) {
                        Object data = switch (id) {
                            case "createKioskPayment" -> kioskPayment;
                            case "listPayments" -> Map.of("content", List.of(item), "page", 0, "size", 20, "totalElements", 1, "totalPages", 1);
                            default -> detail;
                        };
                        example = Map.of("timestamp", timestamp, "message", "Success", "data", data);
                    } else {
                        String error = switch (code) { case "400" -> "Bad Request"; case "401" -> "Unauthorized"; case "403" -> "Forbidden"; case "404" -> "Not Found"; case "409" -> "Conflict"; case "502" -> "Bad Gateway"; default -> "Internal Server Error"; };
                        String message = switch (code) { case "400" -> "Request validation failed"; case "401" -> "Authentication required or access token invalid";
                            case "403" -> "Access denied"; case "404" -> "Payment not found"; case "409" -> "Maximum payment attempts reached for this order";
                            case "502" -> "Payment provider is currently unavailable"; default -> "An unexpected error occurred"; };
                        example = Map.of("timestamp", timestamp, "status", Integer.parseInt(code), "error", error, "message", message, "path", name);
                    }
                    response.getContent().get("application/json").setExample(example);
                });
            });
        });
    }
    @Bean
    public OpenApiCustomizer paymentWebhookExamples() {
        String timestamp = "2026-10-16T04:00:00Z";
        var data = new java.util.LinkedHashMap<String, Object>();
        data.put("orderCode", 261016040005123L); data.put("amount", 105000); data.put("description", "FV7K3QF9X");
        data.put("accountNumber", "0000000000"); data.put("reference", "FT00000000000"); data.put("transactionDateTime", "2026-10-16 11:02:13");
        data.put("currency", "VND"); data.put("paymentLinkId", "fake-link-id"); data.put("code", "00"); data.put("desc", "success");
        data.put("counterAccountBankId", ""); data.put("counterAccountBankName", ""); data.put("counterAccountName", "");
        data.put("counterAccountNumber", ""); data.put("virtualAccountName", ""); data.put("virtualAccountNumber", "");
        var webhook = new java.util.LinkedHashMap<String, Object>();
        webhook.put("code", "00"); webhook.put("desc", "success"); webhook.put("success", true); webhook.put("data", data);
        webhook.put("signature", "<hex-hmac-sha256-of-data>");
        var summary = new java.util.LinkedHashMap<String, Object>();
        summary.put("id", "7a1c0000-0000-4000-8000-000000000001"); summary.put("provider", "PAYOS"); summary.put("eventType", "PAYMENT_SUCCESS");
        summary.put("reference", "261016040005123"); summary.put("verified", true); summary.put("receivedAt", timestamp);
        var detail = new java.util.LinkedHashMap<String, Object>(summary);
        detail.put("rawPayload", webhook); detail.put("rawBody", null);
        return api -> api.getPaths().forEach((name, path) -> {
            if (!name.startsWith("/api/v1/webhooks/payments") && !name.startsWith("/api/v1/payment-webhook-logs")) return;
            path.readOperations().forEach(operation -> {
                String id = operation.getOperationId();
                if (operation.getRequestBody() != null) {
                    operation.getRequestBody().getContent().get("application/json").setExample(webhook);
                }
                operation.getResponses().forEach((code, response) -> {
                    if (code.startsWith("2")) {
                        response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                    }
                    if (code.equals("401") && !id.equals("receivePaymentWebhook")) {
                        response.addHeaderObject("WWW-Authenticate", new Header().schema(new StringSchema()._const("Bearer")));
                    }
                    if (response.getContent() == null || response.getContent().get("application/json") == null) return;
                    Object example;
                    if (code.startsWith("2")) {
                        example = switch (id) {
                            case "receivePaymentWebhook" -> Map.of("success", true);
                            case "listPaymentWebhookLogs" -> Map.of("timestamp", timestamp, "message", "Success", "data",
                                    Map.of("content", List.of(summary), "page", 0, "size", 20, "totalElements", 1, "totalPages", 1));
                            default -> Map.of("timestamp", timestamp, "message", "Success", "data", detail);
                        };
                    } else {
                        String error = switch (code) { case "400" -> "Bad Request"; case "401" -> "Unauthorized"; case "403" -> "Forbidden"; case "404" -> "Not Found";
                            case "413" -> "Payload Too Large"; case "415" -> "Unsupported Media Type"; default -> "Internal Server Error"; };
                        String message = switch (code) { case "400" -> "Request validation failed";
                            case "401" -> id.equals("receivePaymentWebhook") ? "Webhook could not be verified" : "Authentication required or access token invalid";
                            case "403" -> "Access denied"; case "404" -> "Payment provider not found"; case "413" -> "Webhook body is too large";
                            case "415" -> "Unsupported Media Type"; default -> "An unexpected error occurred"; };
                        example = Map.of("timestamp", timestamp, "status", Integer.parseInt(code), "error", error, "message", message, "path", name);
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
                        .description("Paste the access token only (without the Bearer prefix)."))
                        .addSecuritySchemes("kioskKey", new SecurityScheme()
                        .type(SecurityScheme.Type.APIKEY).in(SecurityScheme.In.HEADER).name("X-Kiosk-Key")
                        .description("Machine-bound kiosk key (fvk_<prefix>_<secret>) issued by an ADMIN. Not a user JWT.")));
    }
}
