package com.fruitmachine.backend.customerreport.config;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Public customer report form (issue #74). base-url is the web route of the form; the report token is appended as a path segment.
 * Rate limits are kept in memory (one backend instance). X-Forwarded-For is honoured only from trusted-proxies (exact addresses).
 */
@ConfigurationProperties("app.public-report")
public record PublicReportProperties(String baseUrl, String allowedOrigins, Integer rateLimitPerMinute, Integer rateLimitPerMachinePerHour,
        Integer formRateLimitPerMinute, List<String> trustedProxies, String ipHashSecret, Duration orderLookback) {
    public PublicReportProperties {
        baseUrl = baseUrl == null ? "" : baseUrl.strip();
        allowedOrigins = allowedOrigins == null ? "" : allowedOrigins.strip();
        rateLimitPerMinute = rateLimitPerMinute == null ? 5 : rateLimitPerMinute;
        rateLimitPerMachinePerHour = rateLimitPerMachinePerHour == null ? 60 : rateLimitPerMachinePerHour;
        formRateLimitPerMinute = formRateLimitPerMinute == null ? 30 : formRateLimitPerMinute;
        trustedProxies = trustedProxies == null ? List.of() : trustedProxies.stream().map(String::strip).filter(s -> !s.isEmpty()).toList();
        ipHashSecret = ipHashSecret == null ? "" : ipHashSecret;
        orderLookback = orderLookback == null ? Duration.ofDays(7) : orderLookback;
    }

    /** Comma-separated web origins allowed to call /api/v1/public/** from a browser; empty = no cross-origin access. */
    public List<String> allowedOriginList() {
        return allowedOrigins.isEmpty() ? List.of() : Arrays.stream(allowedOrigins.split(",")).map(String::strip).filter(s -> !s.isEmpty()).toList();
    }
}
