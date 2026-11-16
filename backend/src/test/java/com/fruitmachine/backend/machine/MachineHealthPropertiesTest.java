package com.fruitmachine.backend.machine;

import com.fruitmachine.backend.config.properties.MachineHealthProperties;
import com.fruitmachine.backend.config.properties.TelemetryProperties;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import static org.assertj.core.api.Assertions.assertThat;

/** Issue #53: connectivity thresholds and telemetry limits are validated when the application starts. */
class MachineHealthPropertiesTest {
    @EnableConfigurationProperties({MachineHealthProperties.class, TelemetryProperties.class})
    static class Config { }

    final ApplicationContextRunner runner = new ApplicationContextRunner().withUserConfiguration(Config.class);

    @Test
    void defaultsAreSixtyAndOneHundredEightySeconds() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            var health = context.getBean(MachineHealthProperties.class);
            assertThat(health.warningAfter()).hasSeconds(60);
            assertThat(health.offlineAfter()).hasSeconds(180);
            assertThat(context.getBean(TelemetryProperties.class).minInterval()).hasSeconds(10);
        });
    }

    @Test
    void invalidDurationsFailStartup() {
        for (String[] values : new String[][]{{"PT0S", "PT180S"}, {"-PT1S", "PT180S"}, {"PT180S", "PT180S"}, {"PT200S", "PT180S"}}) {
            runner.withPropertyValues("app.machine-health.warning-after=" + values[0], "app.machine-health.offline-after=" + values[1])
                    .run(context -> assertThat(context).as(String.join(" / ", values)).hasFailed());
        }
        runner.withPropertyValues("app.telemetry.min-interval=-PT1S").run(context -> assertThat(context).hasFailed());
        runner.withPropertyValues("app.telemetry.duplicate-window=PT0S").run(context -> assertThat(context).hasFailed());
    }
}
