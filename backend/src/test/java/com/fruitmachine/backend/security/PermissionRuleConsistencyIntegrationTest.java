package com.fruitmachine.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/**
 * Issue #48 section 9: for every protected operation the URL rule and the @PreAuthorize name the same permission P, and an
 * unauthorized request with invalid input still gets 403 (not 400).
 * <ul>
 * <li>A user holding ONLY P passes both layers: never 401/403.</li>
 * <li>A user holding everything EXCEPT P sends invalid input and gets 403. Input validation (400) runs before the controller's
 * method security, so this 403 can only come from the URL rule: the URL rule requires P.</li>
 * </ul>
 * P comes from x-required-permission, which the OpenAPI customizer reads from the endpoint's own @PreAuthorize.
 */
@TestPropertySource(properties = {"springdoc.api-docs.enabled=true"})
class PermissionRuleConsistencyIntegrationTest extends AbstractCoreIntegrationTest {
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;

    record Operation(String method, String path, String permission, boolean hasPageParameter) {}

    List<Operation> protectedOperations() throws Exception {
        JsonNode docs = json.readTree(mvc.perform(get("/v3/api-docs")).andReturn().getResponse().getContentAsString());
        List<Operation> operations = new ArrayList<>();
        docs.path("paths").fields().forEachRemaining(path -> path.getValue().fields().forEachRemaining(op -> {
            JsonNode security = op.getValue().path("security");
            boolean bearer = security.isArray() && security.size() > 0 && security.get(0).has("bearerAuth");
            // Own notifications (#58) need a signed-in user only: no permission to compare.
            if (!bearer || path.getKey().startsWith("/api/v1/notifications")) return;
            String permission = op.getValue().path("x-required-permission").asText(null);
            boolean page = false;
            for (JsonNode parameter : op.getValue().path("parameters")) page |= "page".equals(parameter.path("name").asText());
            operations.add(new Operation(op.getKey().toUpperCase(), path.getKey(), permission, page));
        }));
        return operations;
    }

    String account(Set<String> permissions) throws Exception {
        UUID role = UUID.randomUUID();
        jdbc.update("INSERT INTO roles (id, name, description) VALUES (?, ?, 'test only')", role, "TEST_" + role.toString().substring(0, 8).toUpperCase());
        for (String code : permissions) {
            jdbc.update("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = ?", role, code);
        }
        User user = new User();
        user.setEmail(UUID.randomUUID() + "@example.invalid");
        user.setFullName("Permission rule test user");
        user.setPasswordHash(encoder.encode(PASSWORD));
        user.setStatus(UserStatus.ACTIVE);
        user = users.saveAndFlush(user);
        jdbc.update("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", user.getId(), role);
        return fixtures.login(user.getEmail(), PASSWORD).token();
    }

    int call(Operation operation, String token, boolean invalidInput) throws Exception {
        String path = operation.path();
        boolean hasPathParameter = path.contains("{");
        path = path.replaceAll("\\{[^}]+}", invalidInput ? "not-a-uuid" : UUID.randomUUID().toString());
        boolean body = Set.of("POST", "PUT", "PATCH").contains(operation.method());
        if (invalidInput && !hasPathParameter && !body) path += operation.hasPageParameter() ? "?page=-1" : "/not-a-uuid";
        var builder = request(HttpMethod.valueOf(operation.method()), path).header("Authorization", "Bearer " + token);
        if (body) builder.contentType("application/json").content("{}");
        return mvc.perform(builder).andReturn().getResponse().getStatus();
    }

    @Test
    void urlRuleAndMethodSecurityRequireTheSamePermissionAnd403PrecedesValidation() throws Exception {
        List<Operation> operations = protectedOperations();
        assertThat(operations).as("protected management operations").hasSizeGreaterThanOrEqualTo(44);
        assertThat(operations).as("every bearer operation documents its permission").allMatch(op -> Permissions.ALL.contains(op.permission()));

        Map<String, String> only = new HashMap<>(), allBut = new HashMap<>();
        for (String code : new TreeSet<>(operations.stream().map(Operation::permission).toList())) {
            only.put(code, account(Set.of(code)));
            Set<String> others = new TreeSet<>(Permissions.ALL);
            others.remove(code);
            allBut.put(code, account(others));
        }
        List<String> failures = new ArrayList<>();
        for (Operation op : operations) {
            String name = op.method() + " " + op.path() + " [" + op.permission() + "]";
            int withOnly = call(op, only.get(op.permission()), false);
            int withOnlyInvalid = call(op, only.get(op.permission()), true);
            int withoutInvalid = call(op, allBut.get(op.permission()), true);
            int withoutValid = call(op, allBut.get(op.permission()), false);
            if (withOnly == 401 || withOnly == 403) failures.add(name + ": holder of only " + op.permission() + " got " + withOnly);
            if (withOnlyInvalid == 401 || withOnlyInvalid == 403) failures.add(name + ": holder of only " + op.permission() + " with invalid input got " + withOnlyInvalid);
            if (withoutInvalid != 403) failures.add(name + ": caller without " + op.permission() + " and invalid input got " + withoutInvalid + " (expected 403 before 400)");
            if (withoutValid != 403) failures.add(name + ": caller without " + op.permission() + " got " + withoutValid);
        }
        assertThat(failures).isEmpty();
    }
}
