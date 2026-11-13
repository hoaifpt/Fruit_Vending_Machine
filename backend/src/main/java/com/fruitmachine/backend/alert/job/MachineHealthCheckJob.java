package com.fruitmachine.backend.alert.job;

import com.fruitmachine.backend.alert.service.MachineHealthCheckRunner;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Trigger only: runs the machine health check every app.health-check.interval (default 60 s). Disabled in the test profile. */
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.health-check.enabled", havingValue = "true", matchIfMissing = true)
public class MachineHealthCheckJob {
    private final MachineHealthCheckRunner runner;

    @Scheduled(fixedDelayString = "${app.health-check.interval:PT60S}", initialDelayString = "${app.health-check.interval:PT60S}")
    public void run() {
        runner.runOnce();
    }
}
