package com.fruitmachine.backend.workorder.repository;

import com.fruitmachine.backend.workorder.entity.WorkOrderEvent;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** Append-only: save and read, no update or delete. */
public interface WorkOrderEventRepository extends Repository<WorkOrderEvent, UUID> {
    WorkOrderEvent save(WorkOrderEvent event);

    @Query("select e from WorkOrderEvent e left join fetch e.actor where e.workOrderId = :id order by e.createdAt, e.id")
    List<WorkOrderEvent> findByWorkOrder(@Param("id") UUID workOrderId);

    void flush();
}
