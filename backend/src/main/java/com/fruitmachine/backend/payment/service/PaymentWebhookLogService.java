package com.fruitmachine.backend.payment.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.payment.dto.PaymentWebhookLogDetailResponse;
import com.fruitmachine.backend.payment.dto.PaymentWebhookLogPageResponse;
import com.fruitmachine.backend.payment.dto.PaymentWebhookLogSummaryResponse;
import com.fruitmachine.backend.payment.entity.PaymentWebhookLog;
import com.fruitmachine.backend.payment.repository.PaymentWebhookLogRepository;
import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** ADMIN read access to webhook evidence. The signature column is never exposed. */
@Service
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class PaymentWebhookLogService {
    private static final Set<String> SORT_FIELDS = Set.of("receivedAt", "provider");
    private final PaymentWebhookLogRepository logs;

    @Transactional(readOnly = true)
    public PaymentWebhookLogPageResponse list(int page, int size, String provider, Boolean verified, String reference,
            Instant receivedFrom, Instant receivedTo, String sort) {
        Specification<PaymentWebhookLog> filter = (root, query, cb) -> {
            var predicates = new ArrayList<Predicate>();
            if (provider != null && !provider.isBlank()) predicates.add(cb.equal(root.get("provider"), provider.strip().toUpperCase(Locale.ROOT)));
            if (verified != null) predicates.add(cb.equal(root.get("verified"), verified));
            if (reference != null && !reference.isBlank()) predicates.add(cb.equal(root.get("orderCode"), reference.strip()));
            if (receivedFrom != null) predicates.add(cb.greaterThanOrEqualTo(root.get("receivedAt"), receivedFrom));
            if (receivedTo != null) predicates.add(cb.lessThan(root.get("receivedAt"), receivedTo));
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        var result = logs.findAll(filter, pageRequest(page, size, sort));
        return new PaymentWebhookLogPageResponse(result.getContent().stream().map(this::summary).toList(), page, size,
                result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public PaymentWebhookLogDetailResponse get(UUID id) {
        var row = logs.findById(id).orElseThrow(() -> new ResourceNotFoundException("Webhook log not found"));
        return new PaymentWebhookLogDetailResponse(row.getId(), row.getProvider(), row.getEventType(), row.getOrderCode(), row.isVerified(),
                row.getReceivedAt(), row.getRawPayload(), row.getRawPayload() == null ? row.getRawBody() : null);
    }

    private PaymentWebhookLogSummaryResponse summary(PaymentWebhookLog row) {
        return new PaymentWebhookLogSummaryResponse(row.getId(), row.getProvider(), row.getEventType(), row.getOrderCode(), row.isVerified(), row.getReceivedAt());
    }

    private PageRequest pageRequest(int page, int size, String input) {
        if (page < 0 || size < 1 || size > 100) throw new BadRequestException("Page must be nonnegative and size between 1 and 100");
        String[] parts = (input == null ? "receivedAt,desc" : input).split(",", -1);
        if (parts.length > 2 || !SORT_FIELDS.contains(parts[0])
                || (parts.length == 2 && !Set.of("asc", "desc").contains(parts[1].toLowerCase(Locale.ROOT)))) {
            throw new BadRequestException("Invalid webhook log sort");
        }
        Sort.Direction direction = parts.length == 2 && parts[1].equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC;
        return PageRequest.of(page, size, Sort.by(direction, parts[0]).and(Sort.by("id")));
    }
}
