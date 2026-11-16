package com.fruitmachine.backend.pricing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.pricing.dto.NearExpiryDiscountResponse;
import com.fruitmachine.backend.pricing.dto.PricingActorResponse;
import com.fruitmachine.backend.pricing.dto.UpdateNearExpiryDiscountRequest;
import com.fruitmachine.backend.pricing.entity.PricingSettings;
import com.fruitmachine.backend.pricing.model.DiscountSetting;
import com.fruitmachine.backend.pricing.repository.PricingSettingsRepository;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.repository.UserRepository;
import jakarta.validation.Valid;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * The Admin-managed near-expiry discount (issue #61). Read per request (no cache), so a change applies to the catalog and the next
 * order at once; existing orders keep their snapshot. Every real change writes one audit_logs row.
 */
@Service
@Validated
@RequiredArgsConstructor
public class PricingSettingsService {
    public static final String AUDIT_ACTION = "PRICING_NEAR_EXPIRY_UPDATED";
    public static final String AUDIT_ENTITY = "PRICING_SETTINGS";

    private final PricingSettingsRepository settings;
    private final AuditLogRepository audits;
    private final UserRepository users;
    private final BusinessCalendar calendar;
    private final ObjectMapper json;
    private final Clock clock;

    /** The current setting for pricing decisions; the caller's transaction (if any) reads it once. */
    @Transactional(readOnly = true)
    public DiscountSetting current() {
        var row = settings.findCurrent().orElseThrow(() -> new IllegalStateException("pricing_settings row is missing (V18 seeds it)"));
        return new DiscountSetting(row.isNearExpiryEnabled(), row.getNearExpiryPercent());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_PRICING_READ)
    public NearExpiryDiscountResponse get() {
        return response(settings.findCurrent().orElseThrow(() -> new IllegalStateException("pricing_settings row is missing")));
    }

    /**
     * Whole replacement under the row lock. A version other than the stored one is 409 (someone changed it since the caller read
     * it). The same values are a no-op: 200, version unchanged, no audit row.
     */
    @Transactional
    @PreAuthorize(Permissions.HAS_PRICING_MANAGE)
    public NearExpiryDiscountResponse update(@Valid UpdateNearExpiryDiscountRequest request) {
        PricingSettings row = settings.findCurrentForUpdate().orElseThrow(() -> new IllegalStateException("pricing_settings row is missing"));
        if (!row.getVersion().equals(request.version()))
            throw new ConflictException("The discount setting was changed by someone else; reload it and try again");
        boolean enabled = request.enabled();
        int percent = request.percent();
        if (row.isNearExpiryEnabled() == enabled && row.getNearExpiryPercent() == percent) return response(row);

        JsonNode before = values(row.isNearExpiryEnabled(), row.getNearExpiryPercent());
        var principal = (AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        var actor = users.getReferenceById(principal.getId());
        row.setNearExpiryEnabled(enabled);
        row.setNearExpiryPercent((short) percent);
        row.setUpdatedAt(clock.instant().truncatedTo(ChronoUnit.MICROS));
        row.setUpdatedBy(actor);
        settings.flush();

        var audit = new AuditLog();
        audit.setUser(actor);
        audit.setAction(AUDIT_ACTION);
        audit.setEntityType(AUDIT_ENTITY);
        audit.setEntityId(row.getId());
        audit.setOldValue(before);
        audit.setNewValue(values(enabled, percent));
        audit.setIpAddress(clientIp());
        audits.save(audit);
        return response(settings.findCurrent().orElseThrow());
    }

    private NearExpiryDiscountResponse response(PricingSettings row) {
        var by = row.getUpdatedBy();
        return new NearExpiryDiscountResponse(row.isNearExpiryEnabled(), row.getNearExpiryPercent(), row.getVersion(), row.getUpdatedAt(),
                by == null ? null : new PricingActorResponse(by.getId(), by.getFullName()), calendar.zone().getId());
    }

    private JsonNode values(boolean enabled, int percent) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("enabled", enabled);
        value.put("percent", percent);
        return json.valueToTree(value);
    }

    /** The caller's address as seen by the backend (X-Forwarded-For from the trusted proxy is applied by the server); at most 45 characters. */
    private static String clientIp() {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) return null;
        String address = attributes.getRequest().getRemoteAddr();
        if (address == null || address.isBlank()) return null;
        return address.length() > 45 ? address.substring(0, 45) : address;
    }
}
