package com.fruitmachine.backend.audit.service;

import com.fruitmachine.backend.audit.dto.AuditLogPageResponse;
import com.fruitmachine.backend.audit.dto.AuditLogResponse;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.common.request.TimeRange;
import com.fruitmachine.backend.security.permission.Permissions;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only audit log for AUDIT_LOG_READ (ADMIN), filtered and paged in the database. */
@Service
@RequiredArgsConstructor
public class AuditLogQueryService {
    public static final int MAX_PAGE_SIZE = 200;
    public static final String SYSTEM = "system";

    private final AuditLogRepository audits;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_AUDIT_LOG_READ)
    public AuditLogPageResponse search(String action, String entityType, UUID entityId, UUID userId, Instant from, Instant to, int page, int size) {
        TimeRange.checkPage(page, size, MAX_PAGE_SIZE);
        TimeRange range = TimeRange.of(from, to);
        var result = audits.search(blankToNull(action), blankToNull(entityType), entityId, userId, range.from(), range.to(),
                PageRequest.of(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        return new AuditLogPageResponse(result.getContent().stream().map(AuditLogQueryService::toResponse).toList(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_AUDIT_LOG_READ)
    public AuditLogResponse get(UUID id) {
        return toResponse(audits.findWithUserById(id).orElseThrow(() -> new ResourceNotFoundException("Audit log entry not found")));
    }

    private static AuditLogResponse toResponse(AuditLog row) {
        var user = row.getUser();
        return new AuditLogResponse(row.getId(), row.getAction(), row.getEntityType(), row.getEntityId(), user == null ? null : user.getId(),
                user == null ? null : user.getEmail(), user == null ? SYSTEM : user.getEmail(), row.getOldValue(), row.getNewValue(),
                row.getIpAddress(), row.getCreatedAt());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }
}
