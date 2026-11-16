package com.fruitmachine.backend.sensor.repository;

import com.fruitmachine.backend.sensor.entity.SensorReading;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads use ix_sensor_readings_machine_time (machine_id, recorded_at DESC). */
public interface SensorReadingRepository extends JpaRepository<SensorReading, Long> {
    Optional<SensorReading> findFirstByMachine_IdOrderByRecordedAtDescIdDesc(UUID machineId);

    /** {@code from} inclusive, {@code to} exclusive; the caller sorts recordedAt DESC, id DESC. */
    @Query(value = "select r from SensorReading r where r.machine.id = :machineId and r.recordedAt >= :from and r.recordedAt < :to",
            countQuery = "select count(r) from SensorReading r where r.machine.id = :machineId and r.recordedAt >= :from and r.recordedAt < :to")
    Page<SensorReading> findHistory(@Param("machineId") UUID machineId, @Param("from") Instant from, @Param("to") Instant to, Pageable pageable);
}
