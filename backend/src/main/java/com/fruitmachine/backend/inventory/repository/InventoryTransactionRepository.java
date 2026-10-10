package com.fruitmachine.backend.inventory.repository;

import com.fruitmachine.backend.inventory.entity.InventoryTransaction;
import java.util.UUID;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.*;

public interface InventoryTransactionRepository extends JpaRepository<InventoryTransaction, UUID>, JpaSpecificationExecutor<InventoryTransaction> {
    @Override @EntityGraph(attributePaths = {"inventoryItem", "inventoryItem.batch"})
    Page<InventoryTransaction> findAll(Specification<InventoryTransaction> specification, Pageable pageable);
}
