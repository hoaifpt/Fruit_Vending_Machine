package com.fruitmachine.backend.notification.service;

import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.common.request.TimeRange;
import com.fruitmachine.backend.notification.dto.MarkedReadResponse;
import com.fruitmachine.backend.notification.dto.NotificationPageResponse;
import com.fruitmachine.backend.notification.dto.NotificationResponse;
import com.fruitmachine.backend.notification.dto.UnreadCountResponse;
import com.fruitmachine.backend.notification.entity.Notification;
import com.fruitmachine.backend.notification.repository.NotificationRepository;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Portal notifications (issue #58). Created for every new alert, after it committed, for ACTIVE users holding ALERT_NOTIFY.
 * Users read and mark only their own notifications: any other id is 404, whoever owns it.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationService {
    public static final int MAX_PAGE_SIZE = 100;

    private final NotificationRepository notifications;
    private final Clock clock;

    /** One notification per recipient for a new alert; called after the alert committed, in a new transaction. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int notifyAlert(UUID alertId) {
        int created = notifications.insertForAlert(alertId, now());
        log.debug("Alert {} notified {} user(s)", alertId, created);
        return created;
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.IS_USER)
    public NotificationPageResponse mine(boolean unreadOnly, int page, int size) {
        TimeRange.checkPage(page, size, MAX_PAGE_SIZE);
        var result = notifications.findOwn(currentUser(), unreadOnly,
                PageRequest.of(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        return new NotificationPageResponse(result.getContent().stream().map(NotificationService::toResponse).toList(), page, size,
                result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.IS_USER)
    public UnreadCountResponse unreadCount() {
        return new UnreadCountResponse(notifications.countUnread(currentUser()));
    }

    /** Idempotent: an already read notification stays as it is. */
    @Transactional
    @PreAuthorize(Permissions.IS_USER)
    public MarkedReadResponse markRead(UUID id) {
        UUID user = currentUser();
        int marked = notifications.markRead(id, user, now());
        if (marked == 0 && !notifications.existsOwn(id, user)) throw new ResourceNotFoundException("Notification not found");
        return new MarkedReadResponse(marked);
    }

    @Transactional
    @PreAuthorize(Permissions.IS_USER)
    public MarkedReadResponse markAllRead() {
        return new MarkedReadResponse(notifications.markAllRead(currentUser(), now()));
    }

    private static NotificationResponse toResponse(Notification n) {
        return new NotificationResponse(n.getId(), n.getAlert() == null ? null : n.getAlert().getId(), n.getTitle(), n.getMessage(), n.getSeverity(),
                n.getReadAt() != null, n.getReadAt(), n.getCreatedAt());
    }

    private static UUID currentUser() {
        return ((AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).getId();
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
