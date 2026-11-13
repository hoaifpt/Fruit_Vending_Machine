package com.fruitmachine.backend.notification.repository;

import com.fruitmachine.backend.notification.entity.Notification;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** A user's own notifications; every method is scoped by user id. Uses ix_notifications_user_unread / ix_notifications_user_time. */
public interface NotificationRepository extends Repository<Notification, UUID> {
    @Query(value = "select n from Notification n left join fetch n.alert where n.user.id = :userId and (:unreadOnly = false or n.readAt is null)",
            countQuery = "select count(n) from Notification n where n.user.id = :userId and (:unreadOnly = false or n.readAt is null)")
    Page<Notification> findOwn(@Param("userId") UUID userId, @Param("unreadOnly") boolean unreadOnly, Pageable pageable);

    @Query("select count(n) from Notification n where n.user.id = :userId and n.readAt is null")
    long countUnread(@Param("userId") UUID userId);

    @Query("select count(n) > 0 from Notification n where n.id = :id and n.user.id = :userId")
    boolean existsOwn(@Param("id") UUID id, @Param("userId") UUID userId);

    @Modifying
    @Query(value = "UPDATE notifications SET read_at = GREATEST(:at, created_at) WHERE id = :id AND user_id = :userId AND read_at IS NULL", nativeQuery = true)
    int markRead(@Param("id") UUID id, @Param("userId") UUID userId, @Param("at") Instant at);

    @Modifying
    @Query(value = "UPDATE notifications SET read_at = GREATEST(:at, created_at) WHERE user_id = :userId AND read_at IS NULL", nativeQuery = true)
    int markAllRead(@Param("userId") UUID userId, @Param("at") Instant at);

    /** One notification per ACTIVE user whose roles grant ALERT_NOTIFY, copied from the alert, in one statement. */
    @Modifying
    @Query(value = """
            INSERT INTO notifications (user_id, alert_id, title, message, severity, created_at)
            SELECT DISTINCT u.id, a.id, a.title, left(a.message, 1000), a.severity, CAST(:at AS TIMESTAMPTZ)
            FROM alerts a
            CROSS JOIN users u
            JOIN user_roles ur ON ur.user_id = u.id
            JOIN role_permissions rp ON rp.role_id = ur.role_id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE a.id = :alertId AND p.code = 'ALERT_NOTIFY' AND u.status = 'ACTIVE'
              AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.alert_id = a.id AND n.user_id = u.id)""", nativeQuery = true)
    int insertForAlert(@Param("alertId") UUID alertId, @Param("at") Instant at);
}
