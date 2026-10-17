package com.fruitmachine.backend.support;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.annotation.Configuration;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * The developer .env may select a real payment provider with real credentials, so tests must never read it, while normal
 * runs keep importing it. Both directions are controlled by the APP_DOTENV_IMPORT placeholder of spring.config.import.
 */
class DotenvIsolationTest {
    @Configuration(proxyBeanMethods = false)
    static class Empty {
    }

    @Test
    void theSurefireRunDoesNotImportAnyDotenv() {
        // pom.xml points the import at a file that does not exist for the whole test JVM.
        assertThat(System.getProperty("APP_DOTENV_IMPORT")).startsWith("optional:file:./target/no-dotenv/");
        try (var context = new SpringApplicationBuilder(Empty.class).web(WebApplicationType.NONE).run()) {
            var sources = context.getEnvironment().getPropertySources().stream().map(source -> source.getName()).toList();
            assertThat(sources).noneMatch(name -> name.contains("/.env") || name.contains("\\.env"));
            assertThat(context.getEnvironment().getProperty("app.payment.payos.api-key", "")).isBlank();
        }
    }

    @Test
    void whenNotDisabledTheDotenvImportStillWorks(@TempDir Path directory) throws Exception {
        Path dotenv = directory.resolve(".env");
        Files.writeString(dotenv, "app.isolation.marker=loaded-from-dotenv\n");
        String location = "optional:file:" + dotenv.toAbsolutePath().toString().replace('\\', '/') + "[.properties]";
        try (var context = new SpringApplicationBuilder(Empty.class).web(WebApplicationType.NONE).run("--APP_DOTENV_IMPORT=" + location)) {
            assertThat(context.getEnvironment().getProperty("app.isolation.marker")).isEqualTo("loaded-from-dotenv");
        }
        try (var context = new SpringApplicationBuilder(Empty.class).web(WebApplicationType.NONE).run()) {
            assertThat(context.getEnvironment().getProperty("app.isolation.marker")).isNull();
        }
    }
}
