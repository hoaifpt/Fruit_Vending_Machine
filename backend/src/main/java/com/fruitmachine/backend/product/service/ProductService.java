package com.fruitmachine.backend.product.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.product.dto.*;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.mapper.ProductMapper;
import com.fruitmachine.backend.product.repository.ProductRepository;
import jakarta.persistence.criteria.Predicate;
import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

@Service
@RequiredArgsConstructor
@Validated
public class ProductService {
    private static final Set<String> SORT_FIELDS = Set.of("id", "sku", "name", "price", "status", "createdAt", "updatedAt");
    private final ProductRepository products;
    private final ProductMapper mapper;

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public ProductPageResponse listProducts(int page, int size, ProductStatus status, String search, String sort) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BadRequestException("Page must be nonnegative and size must be between 1 and 100");
        }
        String needle = search == null ? "" : search.strip().toLowerCase(Locale.ROOT);
        if (needle.length() > 200) throw new BadRequestException("Search must not exceed 200 characters");
        var result = products.findAll((root, query, cb) -> {
            var predicates = new ArrayList<Predicate>();
            if (status != null) predicates.add(cb.equal(root.get("status"), status));
            if (!needle.isEmpty()) {
                // LOCATE gives literal substring semantics: '%' and '_' are not wildcard input.
                predicates.add(cb.or(cb.greaterThan(cb.locate(cb.lower(root.get("name")), needle), 0),
                        cb.greaterThan(cb.locate(cb.lower(root.get("sku")), needle), 0)));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        }, PageRequest.of(page, size, approvedSort(sort)));
        return new ProductPageResponse(result.getContent().stream().map(mapper::toResponse).toList(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    private Sort approvedSort(String input) {
        String[] parts = (input == null ? "createdAt,desc" : input).split(",", -1);
        if (parts.length > 2 || !SORT_FIELDS.contains(parts[0])
                || (parts.length == 2 && !Set.of("asc", "desc").contains(parts[1].toLowerCase(Locale.ROOT)))) {
            throw new BadRequestException("Invalid product sort; use an approved field and asc or desc");
        }
        Sort result = Sort.by(parts.length == 2 && parts[1].equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC, parts[0]);
        return parts[0].equals("id") ? result : result.and(Sort.by("id"));
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public ProductResponse getProduct(UUID id) {
        return mapper.toResponse(products.findById(id).orElseThrow(this::notFound));
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public ProductResponse createProduct(@Valid CreateProductRequest request) {
        if (products.existsBySku(request.sku())) throw new ConflictException("SKU is already in use");
        Product product = new Product();
        product.setSku(request.sku());
        product.setName(request.name());
        product.setDescription(request.description());
        product.setPrice(request.price());
        product.setImageUrl(request.imageUrl());
        product.setStatus(ProductStatus.ACTIVE);
        return mapper.toResponse(products.saveAndFlush(product));
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public ProductResponse updateProduct(UUID id, @Valid UpdateProductRequest request) {
        Product product = products.findForUpdateById(id).orElseThrow(this::notFound);
        product.setName(request.name());
        product.setDescription(request.description());
        product.setPrice(request.price());
        product.setImageUrl(request.imageUrl());
        products.flush();
        return mapper.toResponse(product);
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public ProductResponse updateStatus(UUID id, @Valid UpdateProductStatusRequest request) {
        Product product = products.findForUpdateById(id).orElseThrow(this::notFound);
        product.setStatus(request.status());
        products.flush();
        return mapper.toResponse(product);
    }

    private ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Product not found");
    }
}
