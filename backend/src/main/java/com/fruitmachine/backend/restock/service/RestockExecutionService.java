package com.fruitmachine.backend.restock.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.config.properties.OrderProperties;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.service.InventoryLoader;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.repository.MachineSlotRepository;
import com.fruitmachine.backend.product.batch.repository.ProductBatchRepository;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.repository.ProductRepository;
import com.fruitmachine.backend.restock.dto.RestockLoadRequest;
import com.fruitmachine.backend.restock.dto.RestockLoadResponse;
import com.fruitmachine.backend.restock.entity.RestockLine;
import com.fruitmachine.backend.restock.repository.RestockLineRepository;
import com.fruitmachine.backend.restock.repository.RestockQueries;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import jakarta.validation.Valid;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

/**
 * Loading bowls against a restock line (issue #68 §4.2). Lock order: Product, Batch, Machine, Slot (the global loading order), then
 * the WorkOrder and the line. Bowls get strictly increasing loaded_at so the column's FIFO order is the loading order.
 */
@Service
@Validated
@RequiredArgsConstructor
@EnableConfigurationProperties(OrderProperties.class)
public class RestockExecutionService {
    public static final String BATCH_PRODUCT_MISMATCH = "BATCH_PRODUCT_MISMATCH";
    public static final String BATCH_EXPIRED = "BATCH_EXPIRED";
    public static final String EXPIRY_INVERSION = "EXPIRY_INVERSION";
    public static final String WORK_ORDER_NOT_IN_PROGRESS = "WORK_ORDER_NOT_IN_PROGRESS";

    private final RestockLineRepository lines;
    private final RestockQueries queries;
    private final RestockViewService views;
    private final WorkOrderService workOrders;
    private final InventoryLoader loader;
    private final ProductRepository products;
    private final ProductBatchRepository batches;
    private final MachineRepository machines;
    private final MachineSlotRepository slots;
    private final UserRepository users;
    private final OrderProperties orders;
    private final Clock clock;
    private final jakarta.persistence.EntityManager entityManager;

    @Transactional
    @PreAuthorize(Permissions.HAS_RESTOCK_EXECUTE)
    public RestockLoadResponse load(UUID workOrderId, UUID lineId, @Valid RestockLoadRequest request) {
        RestockLine plan = lines.findById(lineId).filter(l -> l.getWorkOrderId().equals(workOrderId))
                .orElseThrow(() -> new ResourceNotFoundException("Restock line not found"));
        // Unlocked read for the lock order only: detach it, so the row lock below reads the current loaded_quantity.
        entityManager.detach(plan);
        UUID batchProduct = batches.findProductIdById(request.batchId()).orElseThrow(() -> new ResourceNotFoundException("Product batch not found"));
        // Global loading order: Product -> Batch -> Machine -> Slot, then the work order and its line.
        var product = products.findForUpdateById(batchProduct).orElseThrow();
        var batch = batches.findForUpdateById(request.batchId()).orElseThrow();
        var machine = machines.findForUpdateById(plan.getMachineId()).orElseThrow();
        var slot = slots.findForUpdateById(plan.getSlotId()).orElseThrow();
        WorkOrder order = workOrders.lockForExecution(workOrderId);
        RestockPlanningService.requireRestock(order);
        if (order.getStatus() != WorkOrderStatus.IN_PROGRESS)
            throw RestockPlanningService.conflict(WORK_ORDER_NOT_IN_PROGRESS, "start the work order before loading (status " + order.getStatus() + ")");
        RestockLine line = lines.findForUpdateById(lineId).orElseThrow();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        if (!batchProduct.equals(line.getProductId()))
            throw RestockPlanningService.conflict(BATCH_PRODUCT_MISMATCH, "the batch is " + product.getName() + ", the line plans another product");
        if (product.getStatus() != ProductStatus.ACTIVE) throw RestockPlanningService.conflict(RestockPlanningService.PRODUCT_INACTIVE, "product is not ACTIVE");
        if (!batch.getExpiresAt().isAfter(now.plus(orders.reservationTtl())))
            throw RestockPlanningService.conflict(BATCH_EXPIRED, "the batch is expired or expires within the reservation hold");
        if (machine.getStatus() == MachineStatus.INACTIVE) throw new ConflictException("MACHINE_INACTIVE: the machine is INACTIVE");
        // ERROR slots may be loaded: restocking is how a blocked column is fixed.
        if (slot.getStatus() == SlotStatus.INACTIVE) throw RestockPlanningService.conflict(RestockPlanningService.SLOT_INACTIVE, "slot is INACTIVE");
        if (!Boolean.TRUE.equals(request.acknowledgeExpiryInversion())) {
            var blocking = queries.laterExpiring(slot.getId(), batch.getExpiresAt());
            if (!blocking.isEmpty()) {
                String bowls = blocking.stream().limit(20).map(b -> b.getId() + " (" + b.getExpiresAt() + ")").collect(Collectors.joining(", "));
                throw RestockPlanningService.conflict(EXPIRY_INVERSION, "the batch expires " + batch.getExpiresAt() + ", earlier than " + blocking.size()
                        + " bowl(s) already in the column, so it would be trapped behind them: " + bowls
                        + ". Empty the column first or send acknowledgeExpiryInversion=true");
            }
        }
        var actor = users.findById(currentUser()).orElseThrow();
        var loaded = loader.load(batch, slot, machine.getId(), request.quantity(), actor, line.getId(), "Restock " + order.getCode(), now, true);
        line.setLoadedQuantity(line.getLoadedQuantity() + loaded.size());
        lines.flush();
        workOrders.recordNote(order, "Loaded " + loaded.size() + " x batch " + batch.getBatchCode() + " into " + slot.getSlotCode(),
                JsonNodeFactory.instance.objectNode().put("lineId", line.getId().toString()).put("batchId", batch.getId().toString())
                        .put("batchCode", batch.getBatchCode()).put("quantity", loaded.size()).put("slotCode", slot.getSlotCode()));
        return new RestockLoadResponse(views.line(line.getId()), loaded.size(), loaded.stream().map(InventoryItem::getId).toList());
    }

    private static UUID currentUser() {
        return ((AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).getId();
    }
}
