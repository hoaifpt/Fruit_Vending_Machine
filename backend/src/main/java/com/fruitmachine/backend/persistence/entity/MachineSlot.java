package com.fruitmachine.backend.persistence.entity;

import com.fruitmachine.backend.persistence.enums.SlotStatus;
import jakarta.persistence.*;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "machine_slots", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"machine_id", "slot_code"}),
    @UniqueConstraint(columnNames = {"id", "machine_id"})
})
@Getter
@Setter
@NoArgsConstructor
public class MachineSlot extends UpdatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "machine_id", nullable = false)
    private Machine machine;

    @Column(name = "machine_id", nullable = false, insertable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private UUID machineId;

    @Column(name = "slot_code", length = 32, nullable = false)
    private String slotCode;

    @Column(name = "capacity", nullable = false)
    private Integer capacity;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private SlotStatus status = SlotStatus.ACTIVE;

    @OneToMany(mappedBy = "slot", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<InventoryItem> inventoryItems = new HashSet<>();
}
