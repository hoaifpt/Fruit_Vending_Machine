package com.fruitmachine.backend.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.auth.dto.LoginRequest;
import com.fruitmachine.backend.security.jwt.JwtProperties;
import com.fruitmachine.backend.security.jwt.JwtService;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.security.user.CustomUserDetailsService;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.repository.RoleRepository;
import com.fruitmachine.backend.user.repository.UserRepository;
import io.swagger.v3.oas.annotations.Hidden;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.config.import=", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc
@Import(AuthorizationIntegrationTest.RbacTestConfiguration.class)
@Testcontainers
@ExtendWith(OutputCaptureExtension.class)
class AuthorizationIntegrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    static final String PASSWORD = "RBAC-test-only-passphrase!";
    static final String KEY = newKey();
    static final String BASE = "/api/v1/test-only/rbac";

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
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-rbac@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Bootstrap-test-only-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired UserRepository users;
    @Autowired RoleRepository roles;
    @Autowired PasswordEncoder encoder;
    @Autowired CustomUserDetailsService details;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtService tokens;
    @Autowired RbacOperations operations;

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    User account(String... names) {
        User user = new User();
        user.setEmail(UUID.randomUUID() + "@example.invalid");
        user.setFullName("Isolated RBAC test user");
        user.setPasswordHash(encoder.encode(PASSWORD));
        user.setStatus(UserStatus.ACTIVE);
        user = users.saveAndFlush(user);
        for (String name : names) addRole(user, name);
        return user;
    }

    void addRole(User user, String name) {
        jdbc.update("INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)",
                user.getId(), roles.findByName(name).orElseThrow().getId());
    }

    String login(User user) throws Exception {
        var result = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                        .content(mapper.writeValueAsString(new LoginRequest(user.getEmail(), PASSWORD))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.tokenType").value("Bearer"))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn();
        return mapper.readTree(result.getResponse().getContentAsString()).at("/data/accessToken").asText();
    }

    ResultActions request(String operation, String token) throws Exception {
        return mvc.perform(get(BASE + operation).header("Authorization", "Bearer " + token));
    }

    void authenticate(User user) {
        var principal = details.loadUserById(user.getId());
        principal.eraseCredentials();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
    }

    @Test
    void adminCanAccessAdminAndSharedButNotStaffOnly(CapturedOutput output) throws Exception {
        User admin = account("ADMIN");
        String token = login(admin);
        request("/admin", token).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(admin.getId().toString()))
                .andExpect(jsonPath("$.principalAuthorities", contains("ROLE_ADMIN")))
                .andExpect(jsonPath("$.contextAuthorities", contains("ROLE_ADMIN")))
                .andExpect(header().doesNotExist("Set-Cookie"));
        request("/shared", token).andExpect(status().isOk());
        request("/staff", token).andExpect(status().isForbidden());
        assertThat(output.getAll()).doesNotContain(PASSWORD, admin.getPasswordHash(), token, KEY);
    }

    @Test
    void staffCanAccessStaffAndSharedButAdminOnlyReturnsSafe403(CapturedOutput output) throws Exception {
        User staff = account("STAFF");
        String token = login(staff);
        request("/staff", token).andExpect(status().isOk())
                .andExpect(jsonPath("$.principalAuthorities", contains("ROLE_STAFF")))
                .andExpect(jsonPath("$.contextAuthorities", contains("ROLE_STAFF")));
        request("/shared", token).andExpect(status().isOk());
        int before = operations.invocationCount();
        var denied = request("/admin", token).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.timestamp").isString())
                .andExpect(jsonPath("$.status").value(403))
                .andExpect(jsonPath("$.error").value("Forbidden"))
                .andExpect(jsonPath("$.message").value("Access denied"))
                .andExpect(jsonPath("$.path").value(BASE + "/admin"))
                .andExpect(header().doesNotExist("WWW-Authenticate"))
                .andExpect(content().string(not(containsString("hasRole"))))
                .andExpect(content().string(not(containsString(token))))
                .andExpect(content().string(not(containsString(staff.getPasswordHash()))))
                .andReturn();
        assertThat(operations.invocationCount()).isEqualTo(before);
        assertThat(mapper.readTree(denied.getResponse().getContentAsString()).fieldNames()).toIterable()
                .containsExactlyInAnyOrder("timestamp", "status", "error", "message", "path");
        assertThat(output.getAll()).doesNotContain(PASSWORD, staff.getPasswordHash(), token, KEY);
    }

    @Test
    void multipleRolesAuthorizeBothWithoutDuplicateAuthorities() throws Exception {
        User user = account("ADMIN", "STAFF");
        String token = login(user);
        for (String path : List.of("/admin", "/staff", "/shared")) {
            request(path, token).andExpect(status().isOk())
                    .andExpect(jsonPath("$.principalAuthorities", contains("ROLE_ADMIN", "ROLE_STAFF")))
                    .andExpect(jsonPath("$.contextAuthorities", contains("ROLE_ADMIN", "ROLE_STAFF")));
        }
    }

    @Test
    void authenticatedNoRoleUserHasAccessOnlyToAnyAuthenticatedOperation() throws Exception {
        String token = login(account());
        request("/any", token).andExpect(status().isOk())
                .andExpect(jsonPath("$.principalAuthorities", empty()))
                .andExpect(jsonPath("$.contextAuthorities", empty()));
        for (String path : List.of("/admin", "/staff", "/shared")) {
            request(path, token).andExpect(status().isForbidden());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"/admin", "/staff", "/shared", "/any", "/controller-admin"})
    void missingAuthenticationReturnsEntryPoint401(String path) throws Exception {
        mvc.perform(get(BASE + path)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.error").value("Unauthorized"))
                .andExpect(jsonPath("$.message").value("Authentication required or access token invalid"))
                .andExpect(jsonPath("$.path").value(BASE + path))
                .andExpect(header().string("WWW-Authenticate", "Bearer"))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void invalidExpiredWrongSignatureAndMalformedBearerRemain401(CapturedOutput output) throws Exception {
        User user = account("ADMIN");
        var principal = details.loadUserById(user.getId());
        String expired = new JwtService(new JwtProperties(KEY, 1),
                Clock.offset(Clock.systemUTC(), Duration.ofSeconds(-10))).generateToken(principal);
        String otherKey = new JwtService(new JwtProperties(newKey(), 3600), Clock.systemUTC()).generateToken(principal);
        for (String invalid : List.of("a.b.c", expired, otherKey)) {
            request("/admin", invalid).andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.message").value("Authentication required or access token invalid"))
                    .andExpect(content().string(not(containsString(invalid))));
        }
        mvc.perform(get(BASE + "/admin").header("Authorization", "Basic invalid-test-value"))
                .andExpect(status().isUnauthorized());
        assertThat(output.getAll()).doesNotContain(PASSWORD, user.getPasswordHash(), expired, otherKey, KEY);
    }

    @Test
    void dbRoleChangesApplyImmediatelyToSameJwtDespiteItsOriginalClaims() throws Exception {
        User user = account("ADMIN");
        String token = login(user);
        assertThat(tokens.validateToken(token).getStringListClaim("roles")).containsExactly("ROLE_ADMIN");
        request("/admin", token).andExpect(status().isOk());
        jdbc.update("DELETE FROM user_roles WHERE user_id = ?", user.getId());
        addRole(user, "STAFF");
        request("/admin", token).andExpect(status().isForbidden());
        request("/staff", token).andExpect(status().isOk())
                .andExpect(jsonPath("$.contextAuthorities", contains("ROLE_STAFF")));
        jdbc.update("DELETE FROM user_roles WHERE user_id = ?", user.getId());
        request("/shared", token).andExpect(status().isForbidden());
        request("/any", token).andExpect(status().isOk());
        addRole(user, "ADMIN");
        request("/admin", token).andExpect(status().isOk());
        assertThat(tokens.validateToken(token).getStringListClaim("roles")).containsExactly("ROLE_ADMIN");
    }

    @ParameterizedTest
    @EnumSource(value = UserStatus.class, names = {"INACTIVE", "LOCKED"})
    void unavailableAccountCannotLoginOrUsePreviouslyIssuedAdminToken(UserStatus status) throws Exception {
        User user = account("ADMIN");
        String token = login(user);
        jdbc.update("UPDATE users SET status = ? WHERE id = ?", status.name(), user.getId());
        request("/admin", token).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                        .content(mapper.writeValueAsString(new LoginRequest(user.getEmail(), PASSWORD))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void deletedAccountCannotAccessAdminOperation() throws Exception {
        User user = account("ADMIN");
        String token = login(user);
        users.deleteById(user.getId());
        request("/admin", token).andExpect(status().isUnauthorized());
    }

    @Test
    void securityContextIsNotReusedByNextRequest() throws Exception {
        request("/admin", login(account("ADMIN"))).andExpect(status().isOk());
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        mvc.perform(get(BASE + "/admin")).andExpect(status().isUnauthorized());
        request("/admin", login(account("STAFF"))).andExpect(status().isForbidden());
    }

    @Test
    void preAuthorizeIsEnforcedOnActualServiceProxyOutsideHttp() {
        assertThat(AopUtils.isAopProxy(operations)).isTrue();
        int before = operations.invocationCount();
        assertThatThrownBy(operations::adminOnly).isInstanceOf(AuthenticationCredentialsNotFoundException.class);
        assertThat(operations.invocationCount()).isEqualTo(before);
        User admin = account("ADMIN");
        authenticate(admin);
        assertThat(operations.adminOnly().id()).isEqualTo(admin.getId());
        assertThatCode(operations::shared).doesNotThrowAnyException();
        assertThatThrownBy(operations::staffOnly).isInstanceOf(AccessDeniedException.class);
        authenticate(account("STAFF"));
        assertThatCode(operations::staffOnly).doesNotThrowAnyException();
        before = operations.invocationCount();
        assertThatThrownBy(operations::adminOnly).isInstanceOf(AccessDeniedException.class);
        assertThat(operations.invocationCount()).isEqualTo(before);
        assertThatCode(operations::shared).doesNotThrowAnyException();
    }

    @Test
    void controllerMethodAnnotationsAreAlsoEnforced() throws Exception {
        request("/controller-admin", login(account("ADMIN"))).andExpect(status().isOk());
        request("/controller-admin", login(account("STAFF"))).andExpect(status().isForbidden());
    }

    @Test
    void publicLoginHealthAndDocumentationPolicyIsPreserved() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                        .content(mapper.writeValueAsString(new LoginRequest("unknown@example.invalid", PASSWORD))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.message").value("Invalid email or password"));
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        var result = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn();
        assertThat(mapper.readTree(result.getResponse().getContentAsString()).path("paths").fieldNames())
                .toIterable().containsExactlyInAnyOrder("/api/v1/auth/login", "/api/v1/users",
                        "/api/v1/users/{id}", "/api/v1/users/{id}/status",
                        "/api/v1/products", "/api/v1/products/{id}", "/api/v1/products/{id}/status",
                        "/api/v1/machines", "/api/v1/machines/{id}", "/api/v1/machines/{id}/status",
                        "/api/v1/machines/{machineId}/slots", "/api/v1/machines/{machineId}/slots/{slotId}", "/api/v1/machines/{machineId}/slots/{slotId}/status",
                "/api/v1/product-batches", "/api/v1/product-batches/{id}");
        assertThat(result.getResponse().getContentAsString()).doesNotContain("test-only", KEY);
        mvc.perform(get("/api/v1/users")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class RbacTestConfiguration {
        @Bean RbacOperations rbacOperations() { return new RbacOperations(); }
        @Bean RbacTestController rbacTestController(RbacOperations operations) { return new RbacTestController(operations); }
    }

    public record Snapshot(UUID id, List<String> principalAuthorities, List<String> contextAuthorities) { }

    public static class RbacOperations {
        private final AtomicInteger invocations = new AtomicInteger();

        public int invocationCount() { return invocations.get(); }

        @PreAuthorize("hasRole('ADMIN')")
        public Snapshot adminOnly() { return snapshot(); }

        @PreAuthorize("hasRole('STAFF')")
        public Snapshot staffOnly() { return snapshot(); }

        @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
        public Snapshot shared() { return snapshot(); }

        @PreAuthorize("isAuthenticated()")
        public Snapshot anyAuthenticated() { return snapshot(); }

        private Snapshot snapshot() {
            invocations.incrementAndGet();
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            var principal = (AuthenticatedUser) authentication.getPrincipal();
            return new Snapshot(principal.getId(), principal.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList(),
                    authentication.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList());
        }
    }

    @Hidden
    @TestComponent
    @RestController
    @RequestMapping(BASE)
    public static class RbacTestController {
        private final RbacOperations operations;

        public RbacTestController(RbacOperations operations) { this.operations = operations; }

        @GetMapping("/admin")
        public Snapshot admin() { return operations.adminOnly(); }

        @GetMapping("/staff")
        public Snapshot staff() { return operations.staffOnly(); }

        @GetMapping("/shared")
        public Snapshot shared() { return operations.shared(); }

        @GetMapping("/any")
        public Snapshot any() { return operations.anyAuthenticated(); }

        @PreAuthorize("hasRole('ADMIN')")
        @GetMapping("/controller-admin")
        public String controllerAdmin() { return "allowed"; }
    }
}
