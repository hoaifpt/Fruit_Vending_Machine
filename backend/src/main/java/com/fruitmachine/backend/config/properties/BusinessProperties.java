package com.fruitmachine.backend.config.properties;

import java.time.DateTimeException;
import java.time.ZoneId;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Issue #61: the one time zone of every "business day" (order codes, near-expiry discount, report days). The database and JDBC
 * stay UTC; only calendar decisions use this zone. An invalid zone stops the application at startup.
 */
@ConfigurationProperties("app")
public record BusinessProperties(@DefaultValue("Asia/Ho_Chi_Minh") String businessZone) {
    public BusinessProperties {
        if (businessZone == null || businessZone.isBlank()) throw new IllegalArgumentException("app.business-zone is required");
        try {
            ZoneId.of(businessZone.strip());
        } catch (DateTimeException ex) {
            throw new IllegalArgumentException("app.business-zone is not a valid time zone id: " + businessZone);
        }
        businessZone = businessZone.strip();
    }

    public ZoneId zone() {
        return ZoneId.of(businessZone);
    }
}
