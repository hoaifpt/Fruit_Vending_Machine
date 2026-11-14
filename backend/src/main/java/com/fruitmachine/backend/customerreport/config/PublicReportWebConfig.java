package com.fruitmachine.backend.customerreport.config;

import com.fruitmachine.backend.customerreport.ratelimit.ClientIpResolver;
import com.fruitmachine.backend.customerreport.ratelimit.PublicReportRateLimitInterceptor;
import com.fruitmachine.backend.customerreport.ratelimit.SlidingWindowRateLimiter;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Issue #74: rate limits of the public report endpoints run before argument binding and validation. The collaborators are looked up
 * lazily so MVC test slices (which load WebMvcConfigurers but not these components) still start.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(PublicReportProperties.class)
@RequiredArgsConstructor
public class PublicReportWebConfig implements WebMvcConfigurer {
    private final ObjectProvider<SlidingWindowRateLimiter> limiter;
    private final ObjectProvider<ClientIpResolver> clients;
    private final PublicReportProperties properties;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        SlidingWindowRateLimiter rateLimiter = limiter.getIfAvailable();
        ClientIpResolver resolver = clients.getIfAvailable();
        if (rateLimiter == null || resolver == null) return;
        registry.addInterceptor(new PublicReportRateLimitInterceptor(rateLimiter, resolver, properties)).addPathPatterns("/api/v1/public/report-forms/**");
    }
}
