package com.fruitmachine.backend.dispense.service;

import com.fruitmachine.backend.dispense.repository.DispenseCommandRepository;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import java.time.Clock;
import java.time.Duration;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@ConditionalOnProperty(name = "app.dispense.sweep-enabled", havingValue = "true", matchIfMissing = true)
public class DispenseTimeoutScheduler {
    private final DispenseCommandRepository commands;
    private final DispenseService service;
    private final Clock clock;
    private final Duration timeout;

    public DispenseTimeoutScheduler(DispenseCommandRepository commands, DispenseService service, Clock clock,
            DispenseProperties properties) {
        this.commands = commands;
        this.service = service;
        this.clock = clock;
        this.timeout = properties.timeout();
    }

    @Scheduled(fixedDelayString = "${app.dispense.sweep-interval:PT15S}")
    public void sweep() {
        var deadline = clock.instant().minus(timeout);
        for (var id : commands.findTimedOut(java.util.List.of(DispenseStatus.PENDING, DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED), deadline, PageRequest.of(0, 50))) {
            try { service.expire(id, deadline); }
            catch (RuntimeException ex) { log.warn("Could not expire dispense command {}: {}", id, ex.getClass().getSimpleName()); }
        }
    }
}
