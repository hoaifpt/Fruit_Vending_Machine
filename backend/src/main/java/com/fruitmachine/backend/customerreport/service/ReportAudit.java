package com.fruitmachine.backend.customerreport.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** audit_logs rows of customer report changes, with the current user and address. Contact data is never written here. */
@Component
@RequiredArgsConstructor
public class ReportAudit {
    private final AuditLogRepository audits;
    private final UserRepository users;

    public User actor() {
        return users.getReferenceById(actorId());
    }

    public static UUID actorId() {
        return ((AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).getId();
    }

    public void write(String action, String entityType, UUID entityId, JsonNode before, JsonNode after) {
        write(actor(), action, entityType, entityId, before, after);
    }

    public void write(User actor, String action, String entityType, UUID entityId, JsonNode before, JsonNode after) {
        var row = new AuditLog();
        row.setUser(actor);
        row.setAction(action);
        row.setEntityType(entityType);
        row.setEntityId(entityId);
        row.setOldValue(before);
        row.setNewValue(after);
        row.setIpAddress(clientIp());
        audits.save(row);
    }

    private static String clientIp() {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) return null;
        String address = attributes.getRequest().getRemoteAddr();
        if (address == null || address.isBlank()) return null;
        return address.length() > 45 ? address.substring(0, 45) : address;
    }
}
