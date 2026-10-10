package com.fruitmachine.backend.product.batch.mapper;

import com.fruitmachine.backend.product.batch.dto.ProductBatchResponse;
import com.fruitmachine.backend.product.entity.ProductBatch;
import org.springframework.stereotype.Component;

@Component
public class ProductBatchMapper {
    public ProductBatchResponse toResponse(ProductBatch batch) {
        var product = batch.getProduct();
        return new ProductBatchResponse(batch.getId(), batch.getBatchCode(), product.getId(), product.getSku(), product.getName(),
                batch.getManufacturedAt(), batch.getExpiresAt(), batch.getQuantity(),
                batch.getCreatedBy() == null ? null : batch.getCreatedBy().getId(), batch.getCreatedAt());
    }
}
