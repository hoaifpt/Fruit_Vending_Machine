package com.fruitmachine.backend.product.batch.repository;

import com.fruitmachine.backend.product.entity.ProductBatch;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;

public interface ProductBatchRepository extends JpaRepository<ProductBatch, UUID> {
    boolean existsByBatchCode(String batchCode);
    @Query("select b.product.id from ProductBatch b where b.id = :id")
    Optional<UUID> findProductIdById(@org.springframework.data.repository.query.Param("id") UUID id);
    @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from ProductBatch b where b.id = :id")
    Optional<ProductBatch> findForUpdateById(@org.springframework.data.repository.query.Param("id") UUID id);
    // Only a to-one fetch: database pagination stays intact without collection duplication.
    @Override @EntityGraph(attributePaths = "product")
    Page<ProductBatch> findAll(Pageable pageable);
    @EntityGraph(attributePaths = "product")
    Page<ProductBatch> findByProductId(UUID productId, Pageable pageable);
    @Override @EntityGraph(attributePaths = "product")
    Optional<ProductBatch> findById(UUID id);
}
