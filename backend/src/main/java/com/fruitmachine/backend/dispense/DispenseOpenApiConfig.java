package com.fruitmachine.backend.dispense;

import io.swagger.v3.oas.models.headers.Header;
import io.swagger.v3.oas.models.media.StringSchema;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class DispenseOpenApiConfig {
    @Bean
    OpenApiCustomizer dispenseExamples() {
        return api -> api.getPaths().forEach((pathName, path) -> {
            if (!pathName.contains("/dispense-command")) return;
            var command = new LinkedHashMap<String, Object>();
            command.put("id", "d1500000-0000-4000-8000-000000000001");
            command.put("commandCode", "DSP-d1500000-0000-4000-8000-000000000001");
            command.put("orderId", "e0f1a2b3-0000-4000-8000-000000000001");
            command.put("machineId", "9b1e0000-0000-4000-8000-000000000001");
            command.put("slotId", "c6a33ea7-0c1c-4bbf-a890-3b7286d10a04");
            command.put("inventoryItemId", "1e000000-0000-4000-8000-000000000001");
            command.put("status", "PENDING");
            command.put("createdAt", "2026-10-23T04:00:00Z");
            path.readOperations().forEach(operation -> {
                if (operation.getRequestBody() != null) operation.getRequestBody().getContent().get("application/json")
                        .setExample(Map.of("dispatchToken", "00000000-0000-4000-8000-000000000099", "status", "SUCCESS", "bowlCountBefore", 7, "bowlCountAfter", 8));
                operation.getResponses().forEach((code, response) -> {
                    if (code.startsWith("2")) response.addHeaderObject("Cache-Control", new Header().schema(new StringSchema()._const("no-store")));
                    if (response.getContent() == null || response.getContent().get("application/json") == null) return;
                    if (code.startsWith("2")) {
                        Object data;
                        switch (operation.getOperationId()) {
                            case "listPendingKioskDispenses" -> data = List.of(command);
                            case "claimKioskDispense" -> {
                                var sent = new LinkedHashMap<>(command);
                                sent.put("status", "SENT"); sent.put("sentAt", "2026-10-23T04:00:01Z");
                                data = Map.of("command", sent, "dispatchToken", "00000000-0000-4000-8000-000000000099");
                            }
                            case "reportKioskDispenseResult" -> {
                                var complete = new LinkedHashMap<>(command);
                                complete.put("status", "SUCCESS"); complete.put("sentAt", "2026-10-23T04:00:01Z");
                                complete.put("completedAt", "2026-10-23T04:00:08Z"); data = complete;
                            }
                            default -> data = command;
                        }
                        response.getContent().get("application/json").setExample(Map.of("timestamp", "2026-10-23T04:00:08Z", "message", "Success", "data", data));
                    }
                });
            });
        });
    }
}
