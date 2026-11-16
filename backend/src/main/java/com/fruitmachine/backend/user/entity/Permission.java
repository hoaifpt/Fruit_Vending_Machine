package com.fruitmachine.backend.user.entity;

import com.fruitmachine.backend.common.entity.CreatedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Reference data seeded by migrations (V13 and later); never created or deleted through the API. */
@Entity
@Table(name = "permissions")
@Getter
@Setter
@NoArgsConstructor
public class Permission extends CreatedEntity {
    @Column(name = "code", length = 64, nullable = false, unique = true)
    private String code;

    @Column(name = "description", length = 255, nullable = false)
    private String description;
}
