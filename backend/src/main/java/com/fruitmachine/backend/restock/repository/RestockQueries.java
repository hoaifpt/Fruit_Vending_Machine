package com.fruitmachine.backend.restock.repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** Read-only aggregate queries of the restock workflow; nothing is locked. */
public interface RestockQueries extends Repository<com.fruitmachine.backend.restock.entity.RestockLine, UUID> {
    interface SlotState {
        UUID getSlotId(); String getSlotCode(); Integer getCapacity(); String getSlotStatus(); Boolean getRefillGateOpen();
        Long getPhysical(); Long getAvailable(); Long getExpired(); Long getExpiringToday(); Long getFailed();
        String getHeadStatus(); Instant getHeadExpiresAt(); UUID getProductId(); String getProductName(); String getAlertTypes();
    }

    /**
     * Every slot of the machine in one statement: physical bowls (AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED), AVAILABLE bowls that
     * outlive the reservation hold, expired (status or date), expiring today, failed, the head (earliest loaded), the product of the most
     * recently loaded physical bowl, and the open slot alert types.
     */
    @Query(value = """
            WITH phys AS (
                SELECT i.id, i.slot_id, i.status, i.loaded_at, b.expires_at, b.product_id
                FROM inventory_items i JOIN product_batches b ON b.id = i.batch_id JOIN machine_slots s ON s.id = i.slot_id
                WHERE s.machine_id = :machineId AND i.status IN ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED')
            ), heads AS (
                SELECT DISTINCT ON (slot_id) slot_id, status, expires_at FROM phys ORDER BY slot_id, loaded_at, id
            ), latest AS (
                SELECT DISTINCT ON (slot_id) slot_id, product_id FROM phys ORDER BY slot_id, loaded_at DESC, id DESC
            ), counts AS (
                SELECT slot_id, count(*) AS physical,
                       count(*) FILTER (WHERE status = 'AVAILABLE' AND expires_at > :holdDeadline) AS available,
                       count(*) FILTER (WHERE status = 'EXPIRED' OR (status = 'AVAILABLE' AND expires_at <= :now)) AS expired,
                       count(*) FILTER (WHERE status = 'AVAILABLE' AND expires_at > :now AND expires_at < :dayEnd) AS expiring_today,
                       count(*) FILTER (WHERE status = 'DISPENSE_FAILED') AS failed
                FROM phys GROUP BY slot_id
            ), open_alerts AS (
                SELECT slot_id, string_agg(DISTINCT type, ',' ORDER BY type) AS types
                FROM alerts WHERE machine_id = :machineId AND slot_id IS NOT NULL AND status <> 'RESOLVED' GROUP BY slot_id
            )
            SELECT s.id AS "slotId", s.slot_code AS "slotCode", s.capacity AS "capacity", s.status AS "slotStatus", s.refill_gate_open AS "refillGateOpen",
                   coalesce(c.physical, 0) AS "physical", coalesce(c.available, 0) AS "available", coalesce(c.expired, 0) AS "expired",
                   coalesce(c.expiring_today, 0) AS "expiringToday", coalesce(c.failed, 0) AS "failed",
                   h.status AS "headStatus", h.expires_at AS "headExpiresAt", p.id AS "productId", p.name AS "productName", a.types AS "alertTypes"
            FROM machine_slots s
            LEFT JOIN counts c ON c.slot_id = s.id LEFT JOIN heads h ON h.slot_id = s.id LEFT JOIN latest l ON l.slot_id = s.id
            LEFT JOIN products p ON p.id = l.product_id LEFT JOIN open_alerts a ON a.slot_id = s.id
            WHERE s.machine_id = :machineId
            ORDER BY s.slot_code, s.id""", nativeQuery = true)
    List<SlotState> slotStates(@Param("machineId") UUID machineId, @Param("now") Instant now, @Param("holdDeadline") Instant holdDeadline,
            @Param("dayEnd") Instant dayEnd);

    @Query(value = """
            SELECT id FROM alerts WHERE machine_id = :machineId AND slot_id IN (:slotIds) AND status <> 'RESOLVED'
              AND type IN ('LOW_STOCK', 'PRODUCT_EXPIRING', 'PRODUCT_EXPIRED')""", nativeQuery = true)
    List<UUID> openStockAlerts(@Param("machineId") UUID machineId, @Param("slotIds") List<UUID> slotIds);

    /** Physical bowls of a slot whose batch expires later than {@code expiresAt}: a new batch loaded on top would be trapped behind them. */
    interface Blocking {
        UUID getId(); Instant getExpiresAt();
    }

    @Query(value = """
            SELECT i.id AS "id", b.expires_at AS "expiresAt" FROM inventory_items i JOIN product_batches b ON b.id = i.batch_id
            WHERE i.slot_id = :slotId AND i.status IN ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED') AND b.expires_at > :expiresAt
            ORDER BY i.loaded_at, i.id""", nativeQuery = true)
    List<Blocking> laterExpiring(@Param("slotId") UUID slotId, @Param("expiresAt") Instant expiresAt);

    @Query(value = "SELECT slot_code FROM machine_slots WHERE machine_id = :machineId AND refill_gate_open ORDER BY slot_code", nativeQuery = true)
    List<String> openRefillGates(@Param("machineId") UUID machineId);

    /** Maintenance commands linked to the work order (#64), for the restock view and the completion summary. */
    interface LinkedCommand {
        UUID getId(); String getCommandCode(); String getOperation(); String getStatus(); String getReason(); Integer getRemovedCount();
        String getReconciliationOutcome(); String getSlotCode(); Instant getCreatedAt();
    }

    @Query(value = """
            SELECT c.id AS "id", c.command_code AS "commandCode", c.operation AS "operation", c.status AS "status", c.reason AS "reason",
                   c.removed_count AS "removedCount", c.reconciliation_outcome AS "reconciliationOutcome", s.slot_code AS "slotCode", c.created_at AS "createdAt"
            FROM maintenance_commands c LEFT JOIN machine_slots s ON s.id = c.slot_id
            WHERE c.work_order_id = :workOrderId ORDER BY c.created_at, c.id""", nativeQuery = true)
    List<LinkedCommand> linkedCommands(@Param("workOrderId") UUID workOrderId);
}
