package com.fruitmachine.backend.maintenanceplan.job;

import com.fruitmachine.backend.config.properties.MaintenanceScheduleProperties;
import com.fruitmachine.backend.maintenanceplan.service.MaintenancePlanScheduler;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Every app.maintenance-schedule.interval (and shortly after startup); disabled in tests, which call the scheduler directly. */
@Component
@RequiredArgsConstructor
@EnableConfigurationProperties(MaintenanceScheduleProperties.class)
@ConditionalOnProperty(name = "app.maintenance-schedule.enabled", havingValue = "true", matchIfMissing = true)
public class MaintenancePlanJob {
    private final MaintenancePlanScheduler scheduler;
    private final Clock clock;

    @Scheduled(fixedDelayString = "${app.maintenance-schedule.interval:PT1H}", initialDelayString = "PT30S")
    public void run() {
        scheduler.runOnce(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }
}
