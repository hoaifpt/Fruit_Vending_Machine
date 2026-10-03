package com.fruitmachine.backend.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;
import lombok.Getter;
import org.hibernate.annotations.SourceType;
import org.hibernate.annotations.UpdateTimestamp;

@Getter
@MappedSuperclass
public abstract class UpdatedEntity extends CreatedEntity {
    @UpdateTimestamp(source = SourceType.DB)
    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz")
    private Instant updatedAt;
}
