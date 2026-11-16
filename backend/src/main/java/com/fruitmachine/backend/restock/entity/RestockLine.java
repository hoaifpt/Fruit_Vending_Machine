package com.fruitmachine.backend.restock.entity;

import com.fruitmachine.backend.common.entity.UpdatedEntity;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.product.entity.Product;
import jakarta.persistence.*;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One planned restock line (V21). loaded_quantity always equals the LOAD history rows with reference_id = this line. */
@Entity
@Table(name = "restock_lines")
@Getter
@Setter
@NoArgsConstructor
public class RestockLine extends UpdatedEntity {
    @Column(name = "work_order_id", nullable = false)
    private UUID workOrderId;

    @Column(name = "machine_id", nullable = false)
    private UUID machineId;

    @Column(name = "slot_id", nullable = false)
    private UUID slotId;

    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "slot_id", insertable = false, updatable = false)
    private MachineSlot slot;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "product_id", insertable = false, updatable = false)
    private Product product;

    @Column(name = "planned_quantity", nullable = false)
    private int plannedQuantity;

    @Column(name = "loaded_quantity", nullable = false)
    private int loadedQuantity;

    @Column(name = "variance_reason", length = 500)
    private String varianceReason;
}
