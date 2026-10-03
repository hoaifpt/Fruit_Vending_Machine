package com.fruitmachine.backend.security;

import com.fruitmachine.backend.security.jwt.JwtAuthenticationFilter;
import com.fruitmachine.backend.security.jwt.JwtProperties;
import com.fruitmachine.backend.security.jwt.JwtService;
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
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration(proxyBeanMethods = false)
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
            CustomUserDetailsService users, SecurityErrorHandler errors,
            @Value("${springdoc.api-docs.enabled:false}") boolean docsEnabled) throws Exception {
        http.csrf(csrf -> csrf.disable()) // Header-only bearer authentication; no cookie/session credentials.
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .formLogin(form -> form.disable()).httpBasic(basic -> basic.disable()).logout(logout -> logout.disable())
                .exceptionHandling(handler -> handler.authenticationEntryPoint(errors.entryPoint())
                        .accessDeniedHandler(errors.accessDeniedHandler()))
                .authorizeHttpRequests(authorize -> {
                    authorize.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll();
                    authorize.requestMatchers(HttpMethod.POST, "/api/v1/auth/login").permitAll();
                    authorize.requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll();
                    if (docsEnabled) {
                        authorize.requestMatchers(HttpMethod.GET, "/swagger-ui.html", "/swagger-ui/**",
                                "/v3/api-docs", "/v3/api-docs/**", "/v3/api-docs.yaml").permitAll();
                    }
                    authorize.anyRequest().authenticated();
                })
                .addFilterBefore(new JwtAuthenticationFilter(tokens, users, errors), UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
