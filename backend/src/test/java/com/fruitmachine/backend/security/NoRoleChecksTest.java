package com.fruitmachine.backend.security;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

/** Issue #48 section 13: access control is expressed with permissions; only the kiosk keeps a role check. */
class NoRoleChecksTest {
    static final Pattern ROLE_CHECK = Pattern.compile("hasRole\\(\\s*['\"](ADMIN|STAFF)['\"]\\s*\\)|hasAnyRole\\s*\\(|hasAnyAuthority\\(\\s*['\"]ROLE_");

    @Test
    void noAdminOrStaffRoleCheckRemainsInMainSources() throws Exception {
        List<String> offenders;
        try (Stream<Path> files = Files.walk(Path.of("src/main/java"))) {
            offenders = files.filter(p -> p.toString().endsWith(".java")).flatMap(p -> {
                try {
                    var lines = Files.readAllLines(p);
                    return java.util.stream.IntStream.range(0, lines.size()).filter(n -> ROLE_CHECK.matcher(lines.get(n)).find())
                            .mapToObj(n -> p + ":" + (n + 1) + " " + lines.get(n).strip());
                } catch (java.io.IOException e) {
                    throw new java.io.UncheckedIOException(e);
                }
            }).toList();
        }
        assertThat(offenders).isEmpty();
    }

    @Test
    void kioskStillUsesItsRole() throws Exception {
        String config = Files.readString(Path.of("src/main/java/com/fruitmachine/backend/security/SecurityConfig.java"));
        assertThat(config).contains(".hasRole(\"KIOSK\")").doesNotContain("hasRole(\"ADMIN\")", "hasRole(\"STAFF\")");
    }
}
