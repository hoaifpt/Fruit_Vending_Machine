package com.fruitmachine.backend.order.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.config.properties.OrderProperties;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.order.dto.*;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.entity.OrderItem;
import com.fruitmachine.backend.order.entity.OrderItemAllocation;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.mapper.OrderMapper;
import com.fruitmachine.backend.order.repository.OrderItemAllocationRepository;
import com.fruitmachine.backend.order.repository.OrderItemRepository;
import com.fruitmachine.backend.order.repository.OrderRepository;
import com.fruitmachine.backend.payment.dto.KioskPaymentResponse;
import com.fruitmachine.backend.payment.mapper.PaymentMapper;
import com.fruitmachine.backend.payment.repository.PaymentRepository;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.repository.ProductRepository;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import jakarta.persistence.criteria.Predicate;
import jakarta.validation.Valid;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

@Service
@RequiredArgsConstructor
@Validated
@EnableConfigurationProperties(OrderProperties.class)
public class OrderService {
    private static final int MAX_CODE_ATTEMPTS = 3;
    private static final Set<String> SORT_FIELDS = Set.of("createdAt", "totalAmount", "orderCode");

    private final OrderRepository orders;
    private final OrderItemRepository orderItems;
    private final OrderItemAllocationRepository allocations;
    private final ProductRepository products;
    private final MachineRepository machines;
    private final OrderReservationService reservations;
    private final OrderCodeGenerator codes;
    private final OrderMapper mapper;
    private final PaymentRepository paymentRepository;
    private final PaymentMapper paymentMapper;
    private final OrderProperties properties;
    private final Clock clock;

    /**
     * Reserves exactly one bowl atomically: the head (next bowl to dispense) of a sellable slot. Lock order: Product
     * (share), Machine (share), candidate Slots (update, id order), head InventoryItem (update). Loading takes
     * Product, Batch, Machine, Slot and removal Slot, InventoryItem, so no cycle exists.
     */
    @Transactional
    @PreAuthorize("hasRole('KIOSK')")
    public KioskOrderResponse createOrder(AuthenticatedKiosk kiosk, @Valid CreateOrderRequest request) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant expiresAt = now.plus(properties.reservationTtl()).truncatedTo(ChronoUnit.MICROS);

        // The product is loaded through the shared lock so a concurrent deactivation cannot be missed.
        Product product = products.findForShareById(request.productId()).orElseThrow(() -> new ResourceNotFoundException("Product not found"));
        if (product.getStatus() != ProductStatus.ACTIVE) throw new ConflictException("Product is not available for ordering");
        var machine = machines.findForShareById(kiosk.machineId()).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        if (machine.getStatus() != MachineStatus.ACTIVE) throw new ConflictException("Machine is not accepting orders");
        var bowl = reservations.selectHead(machine.getId(), product.getId(), expiresAt);

        var order = new Order();
        order.setMachine(machine);
        order.setStatus(OrderStatus.PENDING_PAYMENT);
        order.setOrderCode(newOrderCode());
        order.setExpiresAt(expiresAt);
        // One purchase = one bowl; immutable price snapshot, later product price changes never alter an existing order.
        order.setSubtotal(product.getPrice());
        order.setTotalAmount(product.getPrice());
        orders.saveAndFlush(order);
        var item = new OrderItem();
        item.setOrder(order);
        item.setProduct(product);
        item.setQuantity(1);
        item.setUnitPrice(product.getPrice());
        item.setTotalPrice(product.getPrice());
        orderItems.saveAndFlush(item);
        order.getItems().add(item);
        reservations.reserve(order, item, bowl, now);
        orders.flush();
        return mapper.kiosk(order, null);
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('KIOSK')")
    public KioskOrderResponse getKioskOrder(AuthenticatedKiosk kiosk, UUID orderId) {
        // Other machine and missing are indistinguishable by design.
        var order = orders.findWithItemsByIdAndMachineId(orderId, kiosk.machineId()).orElseThrow(OrderService::missing);
        return mapper.kiosk(order, currentPayment(order));
    }

    @Transactional
    @PreAuthorize("hasRole('KIOSK')")
    public KioskOrderResponse cancelKioskOrder(AuthenticatedKiosk kiosk, UUID orderId) {
        // Lock order: Order, then InventoryItems (inside release).
        Order order = orders.findForUpdateByIdAndMachineId(orderId, kiosk.machineId()).orElseThrow(OrderService::missing);
        if (order.getStatus() == OrderStatus.PENDING_PAYMENT) {
            reservations.release(order, OrderReservationService.REASON_CANCELLED, clock.instant().truncatedTo(ChronoUnit.MICROS));
        } else if (order.getStatus() != OrderStatus.CANCELLED) {
            throw new ConflictException("Only PENDING_PAYMENT orders can be cancelled");
        }
        return mapper.kiosk(order, currentPayment(order));
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public OrderPageResponse list(int page, int size, OrderStatus status, UUID machineId, Instant createdFrom, Instant createdTo,
            String search, String sort) {
        Specification<Order> filter = (root, query, cb) -> {
            var predicates = new ArrayList<Predicate>();
            if (status != null) predicates.add(cb.equal(root.get("status"), status));
            if (machineId != null) predicates.add(cb.equal(root.get("machine").get("id"), machineId));
            if (createdFrom != null) predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), createdFrom));
            if (createdTo != null) predicates.add(cb.lessThan(root.get("createdAt"), createdTo));
            if (search != null && !search.isBlank()) {
                String literal = search.strip().toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
                predicates.add(cb.like(cb.lower(root.get("orderCode")), "%" + literal + "%", '\\'));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        var result = orders.findAll(filter, pageRequest(page, size, sort));
        Map<UUID, OrderItemRepository.LineCount> counts = result.isEmpty() ? Map.of()
                : orderItems.countLines(result.getContent().stream().map(Order::getId).toList()).stream()
                        .collect(Collectors.toMap(OrderItemRepository.LineCount::getOrderId, Function.identity()));
        var content = result.getContent().stream().map(order -> {
            var count = counts.get(order.getId());
            return mapper.summary(order, count == null ? 0L : count.getLines(), count == null ? 0L : count.getBowls());
        }).toList();
        return new OrderPageResponse(content, page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public OrderDetailResponse getDetail(UUID id) {
        Order order = orders.findWithDetailsById(id).orElseThrow(OrderService::missing);
        Map<UUID, List<OrderItemAllocation>> byLine = allocations.findDetailsByOrderId(id).stream()
                .collect(Collectors.groupingBy(a -> a.getOrderItem().getId()));
        var payments = paymentRepository.findByOrderIdOrderByCreatedAtAscIdAsc(id).stream().map(paymentMapper::summary).toList();
        return mapper.detail(order, byLine, payments);
    }

    private KioskPaymentResponse currentPayment(Order order) {
        return paymentRepository.findTopByOrderIdOrderByCreatedAtDescIdDesc(order.getId()).map(paymentMapper::kiosk).orElse(null);
    }

    private String newOrderCode() {
        for (int attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            String code = codes.generate();
            if (!orders.existsByOrderCode(code)) return code;
        }
        // The UNIQUE constraint remains the final guard; this only avoids a pointless insert.
        throw new ConflictException("Could not allocate a unique order code");
    }

    private PageRequest pageRequest(int page, int size, String input) {
        if (page < 0 || size < 1 || size > 100) throw new BadRequestException("Page must be nonnegative and size between 1 and 100");
        String[] parts = (input == null ? "createdAt,desc" : input).split(",", -1);
        if (parts.length > 2 || !SORT_FIELDS.contains(parts[0])
                || (parts.length == 2 && !Set.of("asc", "desc").contains(parts[1].toLowerCase(Locale.ROOT)))) {
            throw new BadRequestException("Invalid order sort");
        }
        Sort.Direction direction = parts.length == 2 && parts[1].equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC;
        return PageRequest.of(page, size, Sort.by(direction, parts[0]).and(Sort.by("id")));
    }

    private static ResourceNotFoundException missing() {
        return new ResourceNotFoundException("Order not found");
    }
}
