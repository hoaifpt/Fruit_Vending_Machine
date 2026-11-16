package com.fruitmachine.backend.customerreport.ratelimit;

import com.fruitmachine.backend.customerreport.config.PublicReportProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

/**
 * Counts public report requests before the request is bound or validated, so invalid floods are limited too:
 * submissions 5 / minute / source and 60 / hour / machine (report token), form info 30 / minute / source (defaults). Created by
 * PublicReportWebConfig (not a bean, so MVC test slices that do not load the rate limiter are unaffected).
 */
@RequiredArgsConstructor
public class PublicReportRateLimitInterceptor implements HandlerInterceptor {
    private static final Duration MINUTE = Duration.ofMinutes(1);
    private static final Duration HOUR = Duration.ofHours(1);
    private final SlidingWindowRateLimiter limiter;
    private final ClientIpResolver clients;
    private final PublicReportProperties properties;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String source = clients.resolve(request);
        boolean submit = "POST".equalsIgnoreCase(request.getMethod());
        if (submit) {
            check("submit:" + source, properties.rateLimitPerMinute(), MINUTE);
            Object variables = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
            if (variables instanceof Map<?, ?> map && map.get("reportToken") instanceof String token) {
                check("machine:" + token, properties.rateLimitPerMachinePerHour(), HOUR);
            }
        } else {
            check("form:" + source, properties.formRateLimitPerMinute(), MINUTE);
        }
        return true;
    }

    private void check(String key, int limit, Duration window) {
        limiter.tryAcquire(key, limit, window).ifPresent(wait -> {
            throw new TooManyRequestsException(wait);
        });
    }
}
