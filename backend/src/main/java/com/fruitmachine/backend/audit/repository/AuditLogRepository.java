package com.fruitmachine.backend.audit.repository;

import com.fruitmachine.backend.audit.entity.AuditLog;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * audit_logs is append-only by application policy (issue #56): this repository exposes inserts and reads only, no update or delete
 * methods. Reads use ix_audit_logs_time, ix_audit_logs_entity_time and ix_audit_logs_user_time.
 */
public interface AuditLogRepository extends Repository<AuditLog, UUID> {
    AuditLog save(AuditLog row);

    void flush();

    boolean existsByActionAndEntityId(String action, UUID entityId);

    @Query("select a from AuditLog a left join fetch a.user where a.id = :id")
    Optional<AuditLog> findWithUserById(@Param("id") UUID id);

    /** Every filter but the time range is optional (null = no filter); {@code from} inclusive, {@code to} exclusive. The caller sorts. */
    @Query(value = """
            select a from AuditLog a left join fetch a.user u
            where (:action is null or a.action = :action)
              and (:entityType is null or a.entityType = :entityType)
              and (:entityId is null or a.entityId = :entityId)
              and (:userId is null or u.id = :userId)
              and a.createdAt >= :from and a.createdAt < :to""",
            countQuery = """
            select count(a) from AuditLog a left join a.user u
            where (:action is null or a.action = :action)
              and (:entityType is null or a.entityType = :entityType)
              and (:entityId is null or a.entityId = :entityId)
              and (:userId is null or u.id = :userId)
              and a.createdAt >= :from and a.createdAt < :to""")
    Page<AuditLog> search(@Param("action") String action, @Param("entityType") String entityType, @Param("entityId") UUID entityId,
            @Param("userId") UUID userId, @Param("from") Instant from, @Param("to") Instant to, Pageable pageable);
}
