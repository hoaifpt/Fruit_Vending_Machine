package com.fruitmachine.backend.security;

import com.fruitmachine.backend.customerreport.config.PublicReportProperties;
import com.fruitmachine.backend.machine.kiosk.service.KioskCredentialService;
import com.fruitmachine.backend.security.jwt.JwtAuthenticationFilter;
import com.fruitmachine.backend.security.jwt.JwtProperties;
import com.fruitmachine.backend.security.jwt.JwtService;
import com.fruitmachine.backend.security.kiosk.KioskAuthenticationFilter;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.CustomUserDetailsService;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration(proxyBeanMethods = false)
@EnableMethodSecurity
@EnableConfigurationProperties(JwtProperties.class)
public class SecurityConfig {
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(CustomUserDetailsService users, PasswordEncoder encoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(users);
        provider.setPasswordEncoder(encoder);
        return new ProviderManager(provider);
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtService tokens,
            CustomUserDetailsService users, KioskCredentialService kioskCredentials, SecurityErrorHandler errors,
            @Value("${springdoc.api-docs.enabled:false}") boolean docsEnabled, PublicReportProperties publicReports) throws Exception {
        http.csrf(csrf -> csrf.disable()) // Header-only bearer authentication; no cookie/session credentials.
                // Issue #74: only the public report form may be called from the configured web origin(s).
                .cors(cors -> cors.configurationSource(publicCors(publicReports)))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .formLogin(form -> form.disable()).httpBasic(basic -> basic.disable()).logout(logout -> logout.disable())
                .exceptionHandling(handler -> handler.authenticationEntryPoint(errors.entryPoint())
                        .accessDeniedHandler(errors.accessDeniedHandler()))
                .authorizeHttpRequests(authorize -> {
                    authorize.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll();
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/auth/login").permitAll();
                    authorize.requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll();
                    // Issue #74: the public customer report form; nothing else under /api/v1 is anonymous.
                    authorize.requestMatchers("/api/v1/public/**").permitAll();
                    if (docsEnabled) {
                        authorize.requestMatchers(HttpMethod.GET, "/swagger-ui.html", "/swagger-ui/**",
                                "/v3/api-docs", "/v3/api-docs/**", "/v3/api-docs.yaml").permitAll();
                    }
                    // Permission-based (issue #48). Each rule names the same permission as the @PreAuthorize of its endpoint, so an
                    // unauthorized caller gets 403 before request validation (400). Non-GET methods without an endpoint keep 405 for
                    // callers that hold the write permission of the path.
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/users", "/api/v1/users/**").hasAuthority(Permissions.USER_READ);
                    authorize.requestMatchers("/api/v1/users", "/api/v1/users/**").hasAuthority(Permissions.USER_WRITE);
                    authorize.requestMatchers("/api/v1/roles", "/api/v1/roles/**", "/api/v1/permissions", "/api/v1/permissions/**")
                            .hasAuthority(Permissions.PERMISSION_MANAGE);
                    // Kiosks are machine credentials, not users; kiosk and credential rules precede the broader machine rules.
                    authorize.requestMatchers("/api/v1/kiosk", "/api/v1/kiosk/**").hasRole("KIOSK");
                    authorize.requestMatchers("/api/v1/machines/*/kiosk-credentials", "/api/v1/machines/*/kiosk-credentials/**")
                            .hasAuthority(Permissions.KIOSK_CREDENTIAL_MANAGE);
                    // Providers call the webhook without any credential; its signature check is the only trust, and only this exact path is open.
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/webhooks/payments/*").permitAll();
                    authorize.requestMatchers("/api/v1/payment-webhook-logs", "/api/v1/payment-webhook-logs/**")
                            .hasAuthority(Permissions.PAYMENT_WEBHOOK_LOG_READ);
                    // Issue #72: recording a refund is its own permission, before the read-only payments rule.
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/payments/*/refund").hasAuthority(Permissions.PAYMENT_REFUND);
                    authorize.requestMatchers("/api/v1/payments", "/api/v1/payments/**").hasAuthority(Permissions.PAYMENT_READ);
                    authorize.requestMatchers("/api/v1/refunds", "/api/v1/refunds/**").hasAuthority(Permissions.REFUND_READ);
                    authorize.requestMatchers("/api/v1/audit-logs", "/api/v1/audit-logs/**").hasAuthority(Permissions.AUDIT_LOG_READ);
                    // Issue #76: export before the general report rule (its own permission).
                    authorize.requestMatchers("/api/v1/reports/sales/export", "/api/v1/reports/sales/export/**").hasAuthority(Permissions.REPORT_EXPORT);
                    authorize.requestMatchers("/api/v1/reports", "/api/v1/reports/**").hasAuthority(Permissions.REPORT_SALES_READ);
                    authorize.requestMatchers("/api/v1/dashboard", "/api/v1/dashboard/**").hasAuthority(Permissions.DASHBOARD_READ);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/customer-reports", "/api/v1/customer-reports/**").hasAuthority(Permissions.CUSTOMER_REPORT_READ);
                    authorize.requestMatchers("/api/v1/customer-reports", "/api/v1/customer-reports/**").hasAuthority(Permissions.CUSTOMER_REPORT_MANAGE);
                    // Issue #66: before the alert rules (creating a work order from an alert is work order management).
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/alerts/*/work-orders").hasAuthority(Permissions.WORK_ORDER_MANAGE);
                    // Issue #68: restock planning and loading, before the generic work order and machine rules.
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/machines/*/restock-suggestions").hasAuthority(Permissions.RESTOCK_PLAN);
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/machines/*/restock-work-orders").hasAuthority(Permissions.RESTOCK_PLAN);
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/work-orders/*/restock-lines/*/loads").hasAuthority(Permissions.RESTOCK_EXECUTE);
                    authorize.requestMatchers("/api/v1/work-orders/*/restock-lines", "/api/v1/work-orders/*/restock-lines/*").hasAuthority(Permissions.RESTOCK_PLAN);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/work-orders").hasAuthority(Permissions.WORK_ORDER_READ_ALL);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/work-orders/**").hasAuthority(Permissions.WORK_ORDER_READ_ASSIGNED);
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/work-orders/*/start", "/api/v1/work-orders/*/notes", "/api/v1/work-orders/*/complete")
                            .hasAuthority(Permissions.WORK_ORDER_EXECUTE);
                    authorize.requestMatchers("/api/v1/work-orders", "/api/v1/work-orders/**").hasAuthority(Permissions.WORK_ORDER_MANAGE);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/alerts", "/api/v1/alerts/**").hasAuthority(Permissions.ALERT_READ);
                    authorize.requestMatchers("/api/v1/alerts", "/api/v1/alerts/**").hasAuthority(Permissions.ALERT_MANAGE);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/pricing/**").hasAuthority(Permissions.PRICING_READ);
                    authorize.requestMatchers("/api/v1/pricing/**").hasAuthority(Permissions.PRICING_MANAGE);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/orders", "/api/v1/orders/**").hasAuthority(Permissions.ORDER_READ);
                    authorize.requestMatchers("/api/v1/orders", "/api/v1/orders/**").denyAll();
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/products", "/api/v1/products/**").hasAuthority(Permissions.PRODUCT_READ);
                    authorize.requestMatchers("/api/v1/products", "/api/v1/products/**").hasAuthority(Permissions.PRODUCT_WRITE);
                    // Inventory views nested under a machine are inventory reads, not machine reads (same permission as their @PreAuthorize).
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/machines/*/inventory", "/api/v1/machines/*/slots/*/inventory",
                            "/api/v1/machines/*/slots/*/inventory/**").hasAuthority(Permissions.INVENTORY_READ);
                    // Issue #64: before the generic machine rules (STAFF runs maintenance commands without MACHINE_WRITE).
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/machines/*/slots/*/maintenance-commands").hasAuthority(Permissions.MAINTENANCE_COMMAND_EXECUTE);
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/machines/*/reset").hasAuthority(Permissions.MACHINE_RESET);
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/machines/*/report-token/rotate").hasAuthority(Permissions.MACHINE_REPORT_LINK_MANAGE);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/maintenance-plans", "/api/v1/maintenance-plans/**").hasAuthority(Permissions.MAINTENANCE_PLAN_READ);
                    authorize.requestMatchers("/api/v1/maintenance-plans", "/api/v1/maintenance-plans/**").hasAuthority(Permissions.MAINTENANCE_PLAN_MANAGE);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/maintenance-commands", "/api/v1/maintenance-commands/**").hasAuthority(Permissions.MAINTENANCE_COMMAND_READ);
                    authorize.requestMatchers("/api/v1/maintenance-commands", "/api/v1/maintenance-commands/**").hasAuthority(Permissions.MAINTENANCE_COMMAND_EXECUTE);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/machines", "/api/v1/machines/**").hasAuthority(Permissions.MACHINE_READ);
                    authorize.requestMatchers("/api/v1/machines", "/api/v1/machines/**").hasAuthority(Permissions.MACHINE_WRITE);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/product-batches", "/api/v1/product-batches/**").hasAuthority(Permissions.BATCH_READ);
                    authorize.requestMatchers("/api/v1/product-batches", "/api/v1/product-batches/**").hasAuthority(Permissions.BATCH_CREATE);
                    authorize.requestMatchers(HttpMethod.GET, "/api/v1/inventory", "/api/v1/inventory/**").hasAuthority(Permissions.INVENTORY_READ);
                    // Issue #68: direct loading is ADMIN only; Staff loads through restock work orders.
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/inventory/load").hasAuthority(Permissions.INVENTORY_LOAD_DIRECT);
                    authorize.requestMatchers("/api/v1/inventory", "/api/v1/inventory/**").hasAuthority(Permissions.INVENTORY_WRITE);
                    authorize.anyRequest().authenticated();
                })
                .addFilterBefore(new JwtAuthenticationFilter(tokens, users, errors), UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(new KioskAuthenticationFilter(kioskCredentials, errors), JwtAuthenticationFilter.class);
        return http.build();
    }

    private static org.springframework.web.cors.CorsConfigurationSource publicCors(PublicReportProperties properties) {
        var source = new org.springframework.web.cors.UrlBasedCorsConfigurationSource();
        if (properties.allowedOriginList().isEmpty()) return source;
        var config = new org.springframework.web.cors.CorsConfiguration();
        config.setAllowedOrigins(properties.allowedOriginList());
        config.setAllowedMethods(java.util.List.of("GET", "POST"));
        config.setAllowedHeaders(java.util.List.of("Content-Type"));
        config.setExposedHeaders(java.util.List.of("Retry-After"));
        config.setAllowCredentials(false);
        config.setMaxAge(3600L);
        source.registerCorsConfiguration("/api/v1/public/**", config);
        return source;
    }
}
