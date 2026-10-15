package com.fruitmachine.backend.config.properties;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Order reservation settings; invalid values fail application startup. */
@ConfigurationProperties("app.order")
public record OrderProperties(
        @DefaultValue("PT5M") Duration reservationTtl,
        @DefaultValue("5") int maxTotalQuantity,
        @DefaultValue ExpirySweep expirySweep) {
    public OrderProperties {
        if (reservationTtl == null || reservationTtl.isZero() || reservationTtl.isNegative())
            throw new IllegalArgumentException("app.order.reservation-ttl must be positive");
        if (maxTotalQuantity < 1) throw new IllegalArgumentException("app.order.max-total-quantity must be at least 1");
    }

    public record ExpirySweep(
            @DefaultValue("true") boolean enabled,
            @DefaultValue("PT30S") Duration interval,
            @DefaultValue("50") int batchSize) {
        public ExpirySweep {
            if (interval == null || interval.isZero() || interval.isNegative())
                throw new IllegalArgumentException("app.order.expiry-sweep.interval must be positive");
            if (batchSize < 1) throw new IllegalArgumentException("app.order.expiry-sweep.batch-size must be at least 1");
        }
    }
}
