package com.fruitmachine.backend.product.entity;

import com.fruitmachine.backend.common.entity.CreatedEntity;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.user.entity.User;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "product_batches")
@Getter
@Setter
@NoArgsConstructor
public class ProductBatch extends CreatedEntity {
    @Column(name = "batch_code", length = 64, nullable = false, unique = true)
    private String batchCode;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "product_id", nullable = false)
    private Product product;

    @Column(name = "manufactured_at", columnDefinition = "timestamptz", nullable = false)
    private Instant manufacturedAt;

    @Column(name = "expires_at", columnDefinition = "timestamptz", nullable = false)
    private Instant expiresAt;

    @Column(name = "quantity", nullable = false)
    private Integer quantity;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    @OneToMany(mappedBy = "batch", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<InventoryItem> inventoryItems = new HashSet<>();
}
