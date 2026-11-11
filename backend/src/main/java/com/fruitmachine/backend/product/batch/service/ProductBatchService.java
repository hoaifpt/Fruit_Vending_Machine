package com.fruitmachine.backend.product.batch.service;

import com.fruitmachine.backend.common.exception.*;
import com.fruitmachine.backend.product.batch.dto.*;
import com.fruitmachine.backend.product.batch.mapper.ProductBatchMapper;
import com.fruitmachine.backend.product.batch.repository.ProductBatchRepository;
import com.fruitmachine.backend.product.entity.ProductBatch;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.repository.ProductRepository;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.repository.UserRepository;
import jakarta.validation.Valid;
import java.time.Clock;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

@Service @RequiredArgsConstructor @Validated
public class ProductBatchService {
    private static final Set<String> SORT_FIELDS = Set.of("id", "batchCode", "manufacturedAt", "expiresAt", "quantity", "createdAt");
    private final ProductBatchRepository batches;
    private final ProductRepository products;
    private final UserRepository users;
    private final ProductBatchMapper mapper;
    private final Clock clock;

    @Transactional @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public ProductBatchResponse createBatch(@Valid CreateProductBatchRequest request) {
        if (batches.existsByBatchCode(request.batchCode())) throw new ConflictException("Batch code is already in use");
        // Serialize with existing catalog writes so ACTIVE validation cannot race deactivation.
        var product = products.findForUpdateById(request.productId()).orElseThrow(() -> new ResourceNotFoundException("Product not found"));
        if (product.getStatus() != ProductStatus.ACTIVE) throw new ConflictException("Product must be ACTIVE to create a batch");
        if (!request.expiresAt().isAfter(request.manufacturedAt())) throw new BadRequestException("Expiration must be after preparation time");
        if (!request.expiresAt().isAfter(clock.instant())) throw new BadRequestException("Batch must not already be expired");
        var principal = (AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        var creator = users.findById(principal.getId()).orElseThrow(() -> new ResourceNotFoundException("Creator not found"));
        var batch = new ProductBatch();
        batch.setBatchCode(request.batchCode()); batch.setProduct(product);
        batch.setManufacturedAt(request.manufacturedAt()); batch.setExpiresAt(request.expiresAt());
        batch.setQuantity(request.quantity()); batch.setCreatedBy(creator);
        return mapper.toResponse(batches.saveAndFlush(batch));
    }

    @Transactional(readOnly = true) @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public ProductBatchPageResponse listBatches(int page, int size, UUID productId, String sort) {
        if (page < 0 || size < 1 || size > 100) throw new BadRequestException("Page must be nonnegative and size must be between 1 and 100");
        var pageable = PageRequest.of(page, size, approvedSort(sort));
        var result = productId == null ? batches.findAll(pageable) : batches.findByProductId(productId, pageable);
        return new ProductBatchPageResponse(result.getContent().stream().map(mapper::toResponse).toList(), page, size, result.getTotalElements(), result.getTotalPages());
    }
    private Sort approvedSort(String input) {
        String[] parts = (input == null ? "createdAt,desc" : input).split(",", -1);
        if (parts.length > 2 || !SORT_FIELDS.contains(parts[0]) ||
                (parts.length == 2 && !Set.of("asc", "desc").contains(parts[1].toLowerCase(Locale.ROOT))))
            throw new BadRequestException("Invalid batch sort; use an approved field and asc or desc");
        var result = Sort.by(parts.length == 2 && parts[1].equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC, parts[0]);
        return parts[0].equals("id") ? result : result.and(Sort.by("id"));
    }
    @Transactional(readOnly = true) @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public ProductBatchResponse getBatch(UUID id) {
        return mapper.toResponse(batches.findById(id).orElseThrow(() -> new ResourceNotFoundException("Product batch not found")));
    }
}
