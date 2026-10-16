package com.fruitmachine.backend.payment.gateway.payos;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * payOS settings. Binding never fails so that MOCK startup needs no payOS values; completeness is checked by
 * {@link #problems()} only when payOS is the active provider. Secrets are masked in {@link #toString()}.
 */
@ConfigurationProperties("app.payment.payos")
public record PayOsProperties(
        @DefaultValue("https://api-merchant.payos.vn") String baseUrl,
        @DefaultValue("") String clientId,
        @DefaultValue("") String apiKey,
        @DefaultValue("") String checksumKey,
        @DefaultValue("") String returnUrl,
        @DefaultValue("") String cancelUrl,
        @DefaultValue("FV") String descriptionPrefix,
        @DefaultValue("9") int descriptionMaxLength,
        @DefaultValue("PT3S") Duration cancelTimeout) {

    /** Names (never values) of the properties that are missing or invalid. */
    public List<String> problems() {
        var problems = new ArrayList<String>();
        if (isBlank(clientId)) problems.add("app.payment.payos.client-id");
        if (isBlank(apiKey)) problems.add("app.payment.payos.api-key");
        if (isBlank(checksumKey)) problems.add("app.payment.payos.checksum-key");
        if (!isHttpUrl(baseUrl)) problems.add("app.payment.payos.base-url");
        if (!isHttpUrl(returnUrl)) problems.add("app.payment.payos.return-url");
        if (!isHttpUrl(cancelUrl)) problems.add("app.payment.payos.cancel-url");
        if (descriptionPrefix == null || !descriptionPrefix.matches("[A-Za-z0-9]{0,8}")) problems.add("app.payment.payos.description-prefix");
        if (descriptionMaxLength < 1 || descriptionMaxLength > 25
                || (descriptionPrefix != null && descriptionPrefix.length() >= descriptionMaxLength)) problems.add("app.payment.payos.description-max-length");
        if (cancelTimeout == null || cancelTimeout.isZero() || cancelTimeout.isNegative()) problems.add("app.payment.payos.cancel-timeout");
        return problems;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static boolean isHttpUrl(String value) {
        if (isBlank(value)) return false;
        try {
            URI uri = URI.create(value.strip());
            return uri.isAbsolute() && uri.getHost() != null && ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()));
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    @Override
    public String toString() {
        return "PayOsProperties[baseUrl=" + baseUrl + ", clientId=" + mask(clientId) + ", apiKey=" + mask(apiKey)
                + ", checksumKey=" + mask(checksumKey) + ", returnUrl=" + returnUrl + ", cancelUrl=" + cancelUrl
                + ", descriptionPrefix=" + descriptionPrefix + ", descriptionMaxLength=" + descriptionMaxLength
                + ", cancelTimeout=" + cancelTimeout + "]";
    }

    private static String mask(String secret) {
        return isBlank(secret) ? "<unset>" : "***";
    }
}
