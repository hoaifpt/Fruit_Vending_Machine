package com.fruitmachine.backend.order.service;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Trigger only; all business logic lives in OrderExpiryService. */
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.order.expiry-sweep.enabled", havingValue = "true", matchIfMissing = true)
public class OrderExpiryScheduler {
    private final OrderExpiryService expiry;

    @Scheduled(fixedDelayString = "${app.order.expiry-sweep.interval:PT30S}")
    public void sweep() {
        expiry.sweep();
    }
}
