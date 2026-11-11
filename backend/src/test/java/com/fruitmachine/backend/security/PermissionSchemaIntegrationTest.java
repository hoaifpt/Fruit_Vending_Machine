package com.fruitmachine.backend.security;

import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Issue #48 section 10: V13 tables, seeded catalog and role mapping, constraints. */
class PermissionSchemaIntegrationTest extends AbstractCoreIntegrationTest {
    static final UUID ADMIN = UUID.fromString("10000000-0000-0000-0000-000000000001");
    static final UUID STAFF = UUID.fromString("10000000-0000-0000-0000-000000000002");
    static final List<String> STAFF_CODES = List.of("BATCH_CREATE", "BATCH_READ", "INVENTORY_READ", "INVENTORY_WRITE", "MACHINE_READ",
            "ORDER_READ", "PRODUCT_READ");

    List<String> codesOf(UUID role) {
        return jdbc.queryForList("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.code",
                String.class, role);
    }

    @Test
    void v13AppliesAndSeedsExactlyTheCatalogWithFixedIds() {
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("15");
        var rows = jdbc.queryForList("SELECT id, code, description FROM permissions ORDER BY id");
        assertThat(rows).extracting(r -> r.get("code")).containsExactlyElementsOf(Permissions.ALL);
        for (int n = 0; n < rows.size(); n++) {
            assertThat(rows.get(n).get("id")).isEqualTo(UUID.fromString(String.format("20000000-0000-0000-0000-%012d", n + 1)));
            assertThat((String) rows.get(n).get("description")).isNotBlank();
        }
        assertThat(rows).noneMatch(r -> ((String) r.get("code")).startsWith("ROLE_"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_indexes WHERE indexname = 'ix_role_permissions_permission'", Long.class)).isEqualTo(1);
    }

    @Test
    void seededMappingReproducesTheFormerAdminAndStaffAccess() {
        assertThat(codesOf(ADMIN)).containsExactlyElementsOf(Permissions.ALL.stream().sorted().toList());
        assertThat(codesOf(STAFF)).containsExactlyElementsOf(STAFF_CODES);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM role_permissions", Long.class)).isEqualTo(15 + 7);
    }

    @Test
    void codeFormatIsEnforcedByTheCheckConstraint() {
        for (String bad : List.of("ab", "lower_case", "1STARTS_WITH_DIGIT", "HAS-DASH", "HAS SPACE", "", "X".repeat(65))) {
            assertThatThrownBy(() -> jdbc.update("INSERT INTO permissions (code, description) VALUES (?, 'test')", bad))
                    .as(bad).isInstanceOf(DataIntegrityViolationException.class);
        }
        jdbc.update("INSERT INTO permissions (code, description) VALUES ('TEST_ONLY_SCHEMA_CODE', 'test')");
        jdbc.update("DELETE FROM permissions WHERE code = 'TEST_ONLY_SCHEMA_CODE'");
    }

    @Test
    void referencedPermissionCannotBeDeletedButRoleDeletionCascadesItsGrants() {
        assertThatThrownBy(() -> jdbc.update("DELETE FROM permissions WHERE code = 'PRODUCT_READ'")).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = 'PRODUCT_READ'", STAFF))
                .as("primary key (role_id, permission_id)").isInstanceOf(DataIntegrityViolationException.class);
        UUID temporary = UUID.randomUUID();
        jdbc.update("INSERT INTO roles (id, name, description) VALUES (?, 'TEST_ONLY_CASCADE', 'test')", temporary);
        jdbc.update("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = 'PRODUCT_READ'", temporary);
        jdbc.update("DELETE FROM roles WHERE id = ?", temporary);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM role_permissions WHERE role_id = ?", Long.class, temporary)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM permissions WHERE code = 'PRODUCT_READ'", Long.class)).isEqualTo(1);
    }
}
