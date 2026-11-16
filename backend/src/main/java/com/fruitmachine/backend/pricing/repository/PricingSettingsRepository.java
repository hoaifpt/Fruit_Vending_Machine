package com.fruitmachine.backend.pricing.repository;

import com.fruitmachine.backend.pricing.entity.PricingSettings;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** The singleton setting; no save of new rows and no delete. */
public interface PricingSettingsRepository extends Repository<PricingSettings, UUID> {
    @Query("select p from PricingSettings p left join fetch p.updatedBy")
    Optional<PricingSettings> findCurrent();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PricingSettings p")
    Optional<PricingSettings> findCurrentForUpdate();

    void flush();
}
