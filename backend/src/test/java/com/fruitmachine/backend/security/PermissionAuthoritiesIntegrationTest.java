package com.fruitmachine.backend.security;

import com.fruitmachine.backend.security.jwt.JwtService;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.CustomUserDetailsService;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import jakarta.persistence.EntityManagerFactory;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import static org.assertj.core.api.Assertions.assertThat;

/** Issue #48 section 11: authorities = ROLE_* + permission codes, one query, applied on the next request, JWT and kiosk unchanged. */
@TestPropertySource(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@Import(PermissionAuthoritiesIntegrationTest.KioskProbe.class)
class PermissionAuthoritiesIntegrationTest extends AbstractCoreIntegrationTest {
    static final List<String> STAFF_CODES = List.of("ALERT_MANAGE", "ALERT_READ", "BATCH_CREATE", "BATCH_READ", "INVENTORY_READ", "INVENTORY_WRITE",
            "MACHINE_READ", "ORDER_READ", "PRICING_READ", "PRODUCT_READ");
    static final UUID ADMIN_ROLE = UUID.fromString("10000000-0000-0000-0000-000000000001");

    /** Test-only kiosk endpoint (kiosk filter + ROLE_KIOSK rule apply) that reports the authenticated kiosk's authorities. */
    @TestConfiguration
    @RestController
    static class KioskProbe {
        @GetMapping("/api/v1/kiosk/test-only-authorities")
        List<String> authorities() {
            return SecurityContextHolder.getContext().getAuthentication().getAuthorities().stream().map(GrantedAuthority::getAuthority).sorted().toList();
        }
    }

    @Autowired CustomUserDetailsService details;
    @Autowired EntityManagerFactory entityManagerFactory;
    @Autowired JwtService tokens;

    @AfterEach
    void restoreSeededMapping() {
        jdbc.update("DELETE FROM role_permissions WHERE role_id = ?", ADMIN_ROLE);
        jdbc.update("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions", ADMIN_ROLE);
    }

    List<String> authorities(UUID userId) {
        return details.loadUserById(userId).getAuthorities().stream().map(GrantedAuthority::getAuthority).sorted().toList();
    }

    @Test
    void principalCarriesRoleAuthoritiesAndPermissionCodes() {
        var expectedAdmin = new java.util.ArrayList<>(Permissions.ALL);
        expectedAdmin.add("ROLE_ADMIN");
        assertThat(authorities(admin.id())).containsExactlyInAnyOrderElementsOf(expectedAdmin);
        var expectedStaff = new java.util.ArrayList<>(STAFF_CODES);
        expectedStaff.add("ROLE_STAFF");
        assertThat(authorities(staff.id())).containsExactlyInAnyOrderElementsOf(expectedStaff);
    }

    @Test
    void rolesAndPermissionsAreLoadedInOneQuery() {
        var statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        for (UUID id : List.of(admin.id(), staff.id())) {
            statistics.clear();
            assertThat(details.loadUserById(id).getAuthorities()).isNotEmpty();
            assertThat(statistics.getPrepareStatementCount()).as("SQL statements to authenticate %s", id).isEqualTo(1);
        }
        String email = jdbc.queryForObject("SELECT email FROM users WHERE id = ?", String.class, admin.id());
        statistics.clear();
        details.loadUserByUsername(email);
        assertThat(statistics.getPrepareStatementCount()).as("SQL statements for login").isEqualTo(1);
    }

    @Test
    void jwtStillCarriesRolesOnlyAndAPermissionChangeAppliesToTheNextRequestWithTheSameToken() throws Exception {
        assertThat(tokens.validateToken(admin.token()).getStringListClaim("roles")).containsExactly("ROLE_ADMIN");
        Map<String, Object> product = Map.of("sku", "PERM-" + UUID.randomUUID().toString().substring(0, 8), "name", "Permission bowl", "price", new BigDecimal("1000"));
        fixtures.api("POST", "/api/v1/products", product, admin.token(), 201);

        jdbc.update("DELETE FROM role_permissions WHERE role_id = ? AND permission_id = (SELECT id FROM permissions WHERE code = 'PRODUCT_WRITE')", ADMIN_ROLE);
        var denied = fixtures.response("POST", "/api/v1/products", Map.of("sku", "PERM-X", "name", "Denied", "price", 1), admin.token(), 403);
        assertThat(denied.toString()).doesNotContain("PRODUCT_WRITE", "hasAuthority");
        // Reads are untouched by removing the write permission.
        fixtures.api("GET", "/api/v1/products?size=1", null, admin.token(), 200);

        restoreSeededMapping();
        fixtures.api("POST", "/api/v1/products", Map.of("sku", "PERM-" + UUID.randomUUID().toString().substring(0, 8), "name", "Allowed again",
                "price", new BigDecimal("1000")), admin.token(), 201);
    }

    @Test
    void kioskPrincipalIsUnchanged() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String key = fixtures.api("POST", "/api/v1/machines/" + machine + "/kiosk-credentials", null, admin.token(), 201).path("apiKey").asText();
        var result = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/kiosk/test-only-authorities")
                .header("X-Kiosk-Key", key)).andReturn().getResponse();
        assertThat(result.getStatus()).isEqualTo(200);
        assertThat(json.readTree(result.getContentAsString())).hasSize(1);
        assertThat(json.readTree(result.getContentAsString()).get(0).asText()).isEqualTo("ROLE_KIOSK");
    }
}
