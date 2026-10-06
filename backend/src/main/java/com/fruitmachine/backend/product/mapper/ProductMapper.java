package com.fruitmachine.backend.product.mapper;

import com.fruitmachine.backend.product.dto.ProductResponse;
import com.fruitmachine.backend.product.entity.Product;
import org.springframework.stereotype.Component;

@Component
public class ProductMapper {
    public ProductResponse toResponse(Product product) {
        return new ProductResponse(product.getId(), product.getSku(), product.getName(), product.getDescription(),
                product.getPrice(), product.getImageUrl(), product.getStatus(), product.getCreatedAt(), product.getUpdatedAt());
    }
}
