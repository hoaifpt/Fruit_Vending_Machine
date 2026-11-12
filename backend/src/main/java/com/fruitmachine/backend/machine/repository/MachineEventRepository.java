package com.fruitmachine.backend.machine.repository;

import com.fruitmachine.backend.machine.entity.MachineEvent;
import com.fruitmachine.backend.machine.enums.MachineEventSource;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * Read side of the machine history. Deliberately a plain Repository: no save/delete methods, rows are written only by
 * MachineEventWriter (append-only). Uses ix_machine_events_machine_type_time / ix_machine_events_machine_time.
 */
public interface MachineEventRepository extends Repository<MachineEvent, UUID> {
    /** type and source are optional (null = no filter); {@code from} inclusive, {@code to} exclusive, both required. The caller sorts. */
    @Query(value = """
            select e from MachineEvent e where e.machine.id = :machineId
              and (:type is null or e.eventType = :type)
              and (:source is null or e.source = :source)
              and e.createdAt >= :from and e.createdAt < :to""",
            countQuery = """
            select count(e) from MachineEvent e where e.machine.id = :machineId
              and (:type is null or e.eventType = :type)
              and (:source is null or e.source = :source)
              and e.createdAt >= :from and e.createdAt < :to""")
    Page<MachineEvent> findTimeline(@Param("machineId") UUID machineId, @Param("type") String type, @Param("source") MachineEventSource source,
            @Param("from") Instant from, @Param("to") Instant to, Pageable pageable);
}
