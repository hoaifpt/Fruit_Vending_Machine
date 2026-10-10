package com.fruitmachine.backend.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.auth.dto.LoginRequest;
import com.fruitmachine.backend.security.jwt.JwtProperties;
import com.fruitmachine.backend.security.jwt.JwtService;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.dto.CreateUserRequest;
import com.fruitmachine.backend.user.dto.UpdateUserStatusRequest;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.repository.RoleRepository;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.user.repository.UserRoleRepository;
import com.fruitmachine.backend.user.service.UserService;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.config.import=", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true",
        "app.account.password.min-length=12",
        "spring.jpa.properties.hibernate.query.fail_on_pagination_over_collection_fetch=true"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
@org.junit.jupiter.api.extension.ExtendWith(OutputCaptureExtension.class)
class UserManagementIntegrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String PASSWORD = "Test-only-staff-passphrase!";
    static final String KEY = newKey();
    static String newKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-user-management@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder encoder;
    @Autowired RoleRepository roles;
    @MockitoSpyBean UserRepository users;
    @MockitoSpyBean UserRoleRepository memberships;
    @Autowired UserService service;
    @Autowired JdbcTemplate jdbc;
    User admin;
    User staff;
    String adminToken;
    String staffToken;

    @BeforeEach
    void setup() throws Exception {
        jdbc.update("DELETE FROM user_roles");
        jdbc.update("DELETE FROM users");
        admin = account("ADMIN", UserStatus.ACTIVE);
        staff = account("STAFF", UserStatus.ACTIVE);
        adminToken = login(admin);
        staffToken = login(staff);
    }

    User account(String role, UserStatus status) {
        User user = new User();
        user.setEmail(UUID.randomUUID() + "@example.invalid");
        user.setPasswordHash(encoder.encode(PASSWORD));
        user.setFullName("Isolated test account");
        user.setStatus(status);
        users.saveAndFlush(user);
        if (role != null) jdbc.update("INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)", user.getId(), roles.findByName(role).orElseThrow().getId());
        return user;
    }

    String login(User user) throws Exception {
        var response = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(mapper.writeValueAsString(Map.of("email", "  " + user.getEmail().toUpperCase() + "  ", "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(response).at("/data/accessToken").asText();
    }

    MockHttpServletRequestBuilder asAdmin(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + adminToken);
    }

    String createBody(String email) throws Exception {
        return mapper.writeValueAsString(Map.of("email", email, "password", PASSWORD, "fullName", " Nguyen Van A ", "phone", "0901234567"));
    }

    @Test
    void adminCreatesActiveStaffWithEncodedPasswordAndSafeResponse(CapturedOutput output) throws Exception {
        String body = mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json")
                        .content(createBody("  New.Staff@Example.Invalid  ")))
                .andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.email").value("new.staff@example.invalid"))
                .andExpect(jsonPath("$.data.fullName").value("Nguyen Van A"))
                .andExpect(jsonPath("$.data.phone").value("0901234567"))
                .andExpect(jsonPath("$.data.status").value("ACTIVE"))
                .andExpect(jsonPath("$.data.roles", org.hamcrest.Matchers.contains("STAFF")))
                .andExpect(jsonPath("$.data.createdAt").exists()).andExpect(jsonPath("$.data.updatedAt").exists())
                .andExpect(jsonPath("$.data.password").doesNotExist()).andExpect(jsonPath("$.data.passwordHash").doesNotExist())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("/api/v1/users/")))
                .andReturn().getResponse().getContentAsString();
        var user = users.findWithRolesByEmail("new.staff@example.invalid").orElseThrow();
        assertThat(user.getPasswordHash()).isNotEqualTo(PASSWORD).startsWith("$2");
        assertThat(encoder.matches(PASSWORD, user.getPasswordHash())).isTrue();
        assertThat(user.getRoles()).extracting("name").containsExactly("STAFF");
        assertThat(login(user)).isNotBlank();
        assertThat(body + output.getAll()).doesNotContain(PASSWORD, user.getPasswordHash(), adminToken, KEY);
        assertThat(new CreateUserRequest("a@example.invalid", PASSWORD, "Name", null).toString()).doesNotContain(PASSWORD);
    }

    @Test
    void duplicateNormalizedEmailReturnsSafeConflictIncludingExistingAdmin() throws Exception {
        mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(createBody(" " + admin.getEmail().toUpperCase() + " ")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("Email is already in use"))
                .andExpect(content().string(not(containsString(admin.getPasswordHash()))));
        assertThat(users.count()).isEqualTo(2);
    }

    @ParameterizedTest
    @ValueSource(strings = {"email", "password", "fullName"})
    void blankRequiredFieldsAreValidationErrors(String field) throws Exception {
        var body = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(createBody("staff@example.invalid"));
        body.put(field, " ");
        mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(body.toString()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors." + field).exists());
    }

    @ParameterizedTest
    @ValueSource(strings = {"bad-email", "", "a@", "@example.invalid"})
    void invalidEmailsAreRejected(String email) throws Exception {
        mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(createBody(email)))
                .andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"short", "ấấấấấấấấấấấấấấấấấấấấấấấấấ", "😀😀😀😀😀😀😀😀😀😀😀"})
    void sharedPasswordPolicyRejectsWeakOrOversizedUtf8Values(String password) throws Exception {
        var body = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(createBody("staff@example.invalid"));
        body.put("password", password);
        mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(body.toString()))
                .andExpect(status().isBadRequest()).andExpect(content().string(not(containsString(password))));
        assertThat(users.count()).isEqualTo(2);
    }

    @ParameterizedTest
    @ValueSource(strings = {"roles", "status", "id", "passwordHash", "createdAt", "updatedAt"})
    void createRejectsClientControlledRoleStatusAndPersistenceFields(String field) throws Exception {
        var body = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(createBody("staff@example.invalid"));
        if (field.equals("roles")) body.putArray(field).add("ADMIN"); else body.put(field, "client-controlled-value");
        mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(body.toString()))
                .andExpect(status().isBadRequest());
        assertThat(users.count()).isEqualTo(2);
    }

    @Test
    void missingStaffRoleFailsSafelyWithoutCreatingAccountOrRole() throws Exception {
        jdbc.update("DELETE FROM user_roles WHERE role_id = (SELECT id FROM roles WHERE name = 'STAFF')");
        jdbc.update("UPDATE roles SET name = 'TEMP_STAFF' WHERE name = 'STAFF'");
        try {
            mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(createBody("staff@example.invalid")))
                    .andExpect(status().isInternalServerError()).andExpect(jsonPath("$.message").value("An unexpected error occurred"));
            assertThat(users.count()).isEqualTo(2);
            assertThat(roles.findByName("STAFF")).isEmpty();
        } finally {
            jdbc.update("UPDATE roles SET name = 'STAFF' WHERE name = 'TEMP_STAFF'");
        }
    }

    @Test
    void failedMembershipSaveRollsBackUserCreation() throws Exception {
        doThrow(new IllegalStateException("Simulated membership failure")).when(memberships).saveAndFlush(any());
        mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(createBody("rollback@example.invalid")))
                .andExpect(status().isInternalServerError());
        assertThat(users.findByEmail("rollback@example.invalid")).isEmpty();
        assertThat(users.count()).isEqualTo(2);
    }

    @Test
    void databaseUniquenessRaceReturnsSafe409AndOnlyOneStaffAccount() throws Exception {
        // Force both prechecks to miss; PostgreSQL UNIQUE remains the actual race guard.
        doReturn(false).when(users).existsByEmail("race@example.invalid");
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var jobs = java.util.stream.IntStream.range(0, 2).mapToObj(i -> executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(createBody("race@example.invalid")))
                        .andReturn().getResponse();
            })).toList();
            var responses = List.of(jobs.get(0).get(20, TimeUnit.SECONDS), jobs.get(1).get(20, TimeUnit.SECONDS));
            assertThat(responses).extracting(response -> response.getStatus()).containsExactlyInAnyOrder(201, 409);
            var conflict = responses.stream().filter(response -> response.getStatus() == 409).findFirst().orElseThrow();
            assertThat(conflict.getContentAsString()).contains("Request conflicts with existing data").doesNotContain("duplicate key", "SQL", PASSWORD);
        }
        assertThat(users.count()).isEqualTo(3);
        assertThat(users.findWithRolesByEmail("race@example.invalid").orElseThrow().getRoles()).extracting("name").containsExactly("STAFF");
    }

    @Test
    void listingPaginatesInDatabaseAndCombinesFiltersWithoutDuplicatesOrRoleLoss() throws Exception {
        var dual = account("ADMIN", UserStatus.INACTIVE);
        jdbc.update("INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)", dual.getId(), roles.findByName("STAFF").orElseThrow().getId());
        account("STAFF", UserStatus.LOCKED);
        account(null, UserStatus.ACTIVE);
        var first = mvc.perform(asAdmin(get("/api/v1/users")).param("size", "2"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.page").value(0)).andExpect(jsonPath("$.data.size").value(2))
                .andExpect(jsonPath("$.data.totalElements").value(5)).andExpect(jsonPath("$.data.totalPages").value(3))
                .andExpect(jsonPath("$.data.content", hasSize(2))).andReturn().getResponse().getContentAsString();
        var second = mvc.perform(asAdmin(get("/api/v1/users")).param("page", "1").param("size", "2"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.content", hasSize(2))).andReturn().getResponse().getContentAsString();
        var firstIds = mapper.readTree(first).at("/data/content").findValuesAsText("id");
        var secondIds = mapper.readTree(second).at("/data/content").findValuesAsText("id");
        assertThat(firstIds).doesNotContainAnyElementsOf(secondIds);
        mvc.perform(asAdmin(get("/api/v1/users")).param("status", "INACTIVE").param("role", "STAFF"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].roles", containsInAnyOrder("ADMIN", "STAFF")))
                .andExpect(jsonPath("$.data.content[0].status").value("INACTIVE"));
        mvc.perform(asAdmin(get("/api/v1/users")).param("role", "STAFF"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3));
        mvc.perform(asAdmin(get("/api/v1/users")).param("status", "ACTIVE"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(3));
        mvc.perform(asAdmin(get("/api/v1/users")).param("page", "999"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.content", hasSize(0))).andExpect(jsonPath("$.data.totalElements").value(5));
        assertThat(first + second).doesNotContain("passwordHash", "password", admin.getPasswordHash(), staff.getPasswordHash(), "accessToken");
    }

    @ParameterizedTest
    @ValueSource(strings = {"page=-1", "page=bad", "size=0", "size=101", "size=-1", "status=UNKNOWN", "role=UNKNOWN"})
    void invalidPageOrFilterParametersReturn400(String input) throws Exception {
        var parts = input.split("=");
        mvc.perform(asAdmin(get("/api/v1/users")).param(parts[0], parts[1])).andExpect(status().isBadRequest());
    }

    @Test
    void adminRetrievesDetailsAndUpdatesOnlyProfilePreservingIdentityRolesAndHistory() throws Exception {
        mvc.perform(asAdmin(get("/api/v1/users/" + staff.getId())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value(staff.getId().toString()))
                .andExpect(jsonPath("$.data.roles", org.hamcrest.Matchers.contains("STAFF")))
                .andExpect(jsonPath("$.data.passwordHash").doesNotExist());
        mvc.perform(asAdmin(put("/api/v1/users/" + staff.getId())).contentType("application/json")
                        .content("{\"fullName\":\" Nguyen Van B \",\"phone\":\"0912345678\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.fullName").value("Nguyen Van B"))
                .andExpect(jsonPath("$.data.phone").value("0912345678"));
        User updated = users.findWithRolesById(staff.getId()).orElseThrow();
        assertThat(updated.getEmail()).isEqualTo(staff.getEmail());
        assertThat(updated.getPasswordHash()).isEqualTo(staff.getPasswordHash());
        assertThat(updated.getCreatedAt()).isEqualTo(staff.getCreatedAt());
        assertThat(updated.getUpdatedAt()).isAfterOrEqualTo(updated.getCreatedAt());
        assertThat(updated.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(updated.getRoles()).extracting("name").containsExactly("STAFF");
        mvc.perform(asAdmin(put("/api/v1/users/" + staff.getId())).contentType("application/json").content("{\"fullName\":\"Name\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.phone").isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"email", "password", "passwordHash", "roles", "status", "id", "createdAt", "updatedAt"})
    void profileUpdateRejectsFieldsOutsideScope(String field) throws Exception {
        var body = mapper.createObjectNode().put("fullName", "Name").put(field, "prohibited");
        mvc.perform(asAdmin(put("/api/v1/users/" + staff.getId())).contentType("application/json").content(body.toString()))
                .andExpect(status().isBadRequest());
        assertThat(users.findById(staff.getId()).orElseThrow().getFullName()).isEqualTo(staff.getFullName());
    }

    @Test
    void missingUsersAndMalformedUuidUseCommonErrors() throws Exception {
        String path = "/api/v1/users/" + UUID.randomUUID();
        mvc.perform(asAdmin(get(path))).andExpect(status().isNotFound()).andExpect(jsonPath("$.message").value("User not found"));
        mvc.perform(asAdmin(put(path)).contentType("application/json").content("{\"fullName\":\"Name\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(asAdmin(patch(path + "/status")).contentType("application/json").content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(asAdmin(get("/api/v1/users/not-a-uuid"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.status").value(400));
    }

    @ParameterizedTest
    @EnumSource(value = UserStatus.class, names = {"INACTIVE", "LOCKED"})
    void adminChangesStaffStatusBlockingLoginAndOldJwtThenReactivates(UserStatus state) throws Exception {
        mvc.perform(asAdmin(patch("/api/v1/users/" + staff.getId() + "/status")).contentType("application/json")
                        .content(mapper.writeValueAsString(new UpdateUserStatusRequest(state))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value(state.name()));
        mvc.perform(post("/api/v1/auth/login").contentType("application/json").content(mapper.writeValueAsString(new LoginRequest(staff.getEmail(), PASSWORD))))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/users").header("Authorization", "Bearer " + staffToken)).andExpect(status().isUnauthorized());
        mvc.perform(asAdmin(patch("/api/v1/users/" + staff.getId() + "/status")).contentType("application/json").content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("ACTIVE"));
        assertThat(login(staff)).isNotBlank();
        assertThat(users.findWithRolesById(staff.getId()).orElseThrow().getRoles()).extracting("name").containsExactly("STAFF");
        assertThat(users.count()).isEqualTo(2);
    }

    @ParameterizedTest
    @EnumSource(value = UserStatus.class, names = {"INACTIVE", "LOCKED"})
    void currentAndLastAdminCannotBeDisabledOrLocked(UserStatus state) throws Exception {
        mvc.perform(asAdmin(patch("/api/v1/users/" + admin.getId() + "/status")).contentType("application/json")
                        .content(mapper.writeValueAsString(new UpdateUserStatusRequest(state))))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("You cannot disable or lock your own account"));
        assertThat(users.countByStatusAndRoleMemberships_Role_Name(UserStatus.ACTIVE, "ADMIN")).isEqualTo(1);
        assertThat(login(admin)).isNotBlank();
    }

    @Test
    void concurrentAdminsCannotDisableEachOtherLeavingNoUsableAdmin() throws Exception {
        User second = account("ADMIN", UserStatus.ACTIVE);
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var a = executor.submit(() -> statusAsActor(admin, second, barrier));
            var b = executor.submit(() -> statusAsActor(second, admin, barrier));
            assertThat(List.of(a.get(20, TimeUnit.SECONDS), b.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("success", "denied");
        }
        assertThat(users.countByStatusAndRoleMemberships_Role_Name(UserStatus.ACTIVE, "ADMIN")).isEqualTo(1);
    }

    String statusAsActor(User actor, User target, CyclicBarrier barrier) throws Exception {
        var principal = new AuthenticatedUser(actor.getId(), actor.getEmail(), "", UserStatus.ACTIVE, List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
        try {
            barrier.await(10, TimeUnit.SECONDS);
            service.updateStatus(target.getId(), new UpdateUserStatusRequest(UserStatus.INACTIVE));
            return "success";
        } catch (AccessDeniedException ex) {
            return "denied";
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"status\":null}", "{\"status\":\"OTHER\"}", "{\"status\":\"ACTIVE\",\"roles\":[\"ADMIN\"]}", "null", "{"})
    void statusRequestIsStrictlyValidated(String body) throws Exception {
        mvc.perform(asAdmin(patch("/api/v1/users/" + staff.getId() + "/status")).contentType("application/json").content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void validationMatchesSchemaLimitsForCreateAndUpdate() throws Exception {
        for (var entry : Map.of("email", "a".repeat(250) + "@example.invalid", "fullName", "a".repeat(201), "phone", "1".repeat(33), "password", "a".repeat(73)).entrySet()) {
            var body = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(createBody("valid@example.invalid"));
            body.put(entry.getKey(), entry.getValue());
            mvc.perform(asAdmin(post("/api/v1/users")).contentType("application/json").content(body.toString())).andExpect(status().isBadRequest());
        }
        for (String body : List.of("{}", "{\"fullName\":\" \"}", "{\"fullName\":\"" + "a".repeat(201) + "\"}",
                "{\"fullName\":\"Name\",\"phone\":\"" + "1".repeat(33) + "\"}")) {
            mvc.perform(asAdmin(put("/api/v1/users/" + staff.getId())).contentType("application/json").content(body)).andExpect(status().isBadRequest());
        }
    }

    @Test
    void everyEndpointRequiresCurrentAdminViaExistingJwtSecurity() throws Exception {
        for (String token : List.of(staffToken, "")) {
            for (var request : List.of(get("/api/v1/users"), get("/api/v1/users/" + staff.getId()),
                    post("/api/v1/users").contentType("application/json").content(createBody("no-access@example.invalid")),
                    put("/api/v1/users/" + staff.getId()).contentType("application/json").content("{\"fullName\":\"Name\"}"),
                    patch("/api/v1/users/" + staff.getId() + "/status").contentType("application/json").content("{\"status\":\"LOCKED\"}"))) {
                if (!token.isEmpty()) request.header("Authorization", "Bearer " + token);
                mvc.perform(request).andExpect(status().is(token.isEmpty() ? 401 : 403))
                        .andExpect(jsonPath("$.message").value(token.isEmpty() ? "Authentication required or access token invalid" : "Access denied"));
            }
        }
        mvc.perform(asAdmin(delete("/api/v1/users/" + staff.getId()))).andExpect(status().isMethodNotAllowed());
        assertThat(users.count()).isEqualTo(2);
        jdbc.update("DELETE FROM user_roles WHERE user_id = ?", admin.getId());
        mvc.perform(asAdmin(get("/api/v1/users"))).andExpect(status().isForbidden());
    }

    @Test
    void invalidExpiredAndWrongKeyTokensAreRejected() throws Exception {
        var principal = new AuthenticatedUser(admin.getId(), admin.getEmail(), "", UserStatus.ACTIVE, List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
        String expired = new JwtService(new JwtProperties(KEY, 1), Clock.offset(Clock.systemUTC(), Duration.ofSeconds(-10))).generateToken(principal);
        String wrong = new JwtService(new JwtProperties(newKey(), 3600), Clock.systemUTC()).generateToken(principal);
        for (String token : List.of("bad-token", expired, wrong)) {
            mvc.perform(get("/api/v1/users").header("Authorization", "Bearer " + token)).andExpect(status().isUnauthorized());
        }
    }
}
