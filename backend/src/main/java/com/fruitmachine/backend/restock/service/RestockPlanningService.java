package com.fruitmachine.backend.restock.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.repository.MachineSlotRepository;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.repository.ProductRepository;
import com.fruitmachine.backend.restock.dto.CreateRestockWorkOrderRequest;
import com.fruitmachine.backend.restock.dto.RestockLineResponse;
import com.fruitmachine.backend.restock.dto.RestockSuggestionResponse;
import com.fruitmachine.backend.restock.dto.UpdateRestockLineRequest;
import com.fruitmachine.backend.restock.entity.RestockLine;
import com.fruitmachine.backend.restock.repository.RestockLineRepository;
import com.fruitmachine.backend.restock.repository.RestockQueries;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.workorder.dto.CreateWorkOrderRequest;
import com.fruitmachine.backend.workorder.dto.RestockLineInput;
import com.fruitmachine.backend.workorder.dto.WorkOrderResponse;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import com.fruitmachine.backend.workorder.service.WorkOrderCreationExtension;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import com.fruitmachine.backend.workorder.service.WorkOrderStartCheck;
import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

/** Planning of RESTOCK work orders (issue #68 §3): lines on create, from suggestions, and line edits while nothing is loaded. */
@Service
@Validated
@RequiredArgsConstructor
public class RestockPlanningService implements WorkOrderCreationExtension, WorkOrderStartCheck {
    public static final String RESTOCK_WITHOUT_LINES = "RESTOCK_WITHOUT_LINES";
    public static final String LINE_ALREADY_LOADED = "LINE_ALREADY_LOADED";
    public static final String DUPLICATE_LINE = "DUPLICATE_LINE";
    public static final String SLOT_INACTIVE = "SLOT_INACTIVE";
    public static final String PRODUCT_INACTIVE = "PRODUCT_INACTIVE";
    public static final String NOTHING_TO_RESTOCK = "NOTHING_TO_RESTOCK";

    private final RestockLineRepository lines;
    private final RestockQueries queries;
    private final RestockSuggestionService suggestions;
    private final RestockViewService views;
    private final WorkOrderService workOrders;
    private final MachineRepository machines;
    private final MachineSlotRepository slots;
    private final ProductRepository products;
    private final jakarta.persistence.EntityManager entityManager;

    // ---- work order hooks ----

    @Override
    public void afterCreate(WorkOrder order, CreateWorkOrderRequest request) {
        if (request.restockLines() == null || request.restockLines().isEmpty()) return;
        if (!has(Permissions.RESTOCK_PLAN)) throw new AccessDeniedException("Restock lines need RESTOCK_PLAN");
        for (RestockLineInput input : request.restockLines()) add(order, input);
    }

    @Override
    public boolean supports(WorkOrderType type) {
        return type == WorkOrderType.RESTOCK;
    }

    @Override
    public void check(WorkOrder order) {
        if (!lines.existsByWorkOrderId(order.getId())) throw conflict(RESTOCK_WITHOUT_LINES, "plan at least one restock line before starting");
    }

    // ---- planning API ----

    @Transactional
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    public WorkOrderResponse createFromSuggestions(UUID machineId, @Valid CreateRestockWorkOrderRequest request) {
        var machine = machines.findById(machineId).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        RestockSuggestionResponse suggested = suggestions.compute(machineId);
        List<RestockLineInput> planned = new ArrayList<>();
        List<UUID> slotIds = new ArrayList<>();
        for (var slot : suggested.slots()) {
            if (slot.suggestedAction() == RestockSuggestionResponse.Action.NONE || slot.currentProduct() == null || slot.suggestedLoadQuantity() <= 0) continue;
            planned.add(new RestockLineInput(slot.slotId(), slot.currentProduct().id(), slot.suggestedLoadQuantity()));
            slotIds.add(slot.slotId());
        }
        if (planned.isEmpty()) throw conflict(NOTHING_TO_RESTOCK, "no slot of this machine needs restocking (or no product is known for it)");
        String title = request.title() == null || request.title().isBlank() ? "Nạp hàng máy " + machine.getCode() : request.title().strip();
        WorkOrderResponse created = workOrders.create(new CreateWorkOrderRequest(WorkOrderType.RESTOCK, machineId, title, null, request.priority(),
                request.assigneeId(), request.dueAt(), planned));
        workOrders.linkAlertsQuietly(created.id(), queries.openStockAlerts(machineId, slotIds));
        return workOrders.get(created.id());
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    public RestockLineResponse addLine(UUID workOrderId, @Valid RestockLineInput input) {
        WorkOrder order = workOrders.lockForPlanning(workOrderId);
        requireRestock(order);
        RestockLine line = add(order, input);
        return views.line(line.getId());
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    public RestockLineResponse updateLine(UUID workOrderId, UUID lineId, @Valid UpdateRestockLineRequest request) {
        WorkOrder order = workOrders.lockForPlanning(workOrderId);
        requireRestock(order);
        RestockLine line = lockLine(order, lineId);
        if (line.getLoadedQuantity() > 0) throw conflict(LINE_ALREADY_LOADED, "bowls were loaded against this line; plan the difference as a variance");
        MachineSlot slot = slots.findById(line.getSlotId()).orElseThrow();
        if (request.productId() != null && !request.productId().equals(line.getProductId())) {
            activeProduct(request.productId());
            if (lines.existsByWorkOrderIdAndSlotIdAndProductId(order.getId(), line.getSlotId(), request.productId()))
                throw conflict(DUPLICATE_LINE, "this work order already plans that product for that slot");
            line.setProductId(request.productId());
        }
        if (request.plannedQuantity() != null) {
            requireCapacity(slot, request.plannedQuantity());
            line.setPlannedQuantity(request.plannedQuantity());
        }
        lines.flush();
        entityManager.refresh(line);
        return views.line(line.getId());
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    public void deleteLine(UUID workOrderId, UUID lineId) {
        WorkOrder order = workOrders.lockForPlanning(workOrderId);
        requireRestock(order);
        RestockLine line = lockLine(order, lineId);
        if (line.getLoadedQuantity() > 0) throw conflict(LINE_ALREADY_LOADED, "bowls were loaded against this line");
        lines.delete(line);
        lines.flush();
    }

    // ---- helpers ----

    private RestockLine add(WorkOrder order, RestockLineInput input) {
        MachineSlot slot = slots.findByIdAndMachineId(input.slotId(), order.getMachineId())
                .orElseThrow(() -> new BadRequestException("slotId must be a slot of the work order's machine"));
        if (slot.getStatus() == SlotStatus.INACTIVE) throw conflict(SLOT_INACTIVE, "slot " + slot.getSlotCode() + " is INACTIVE");
        activeProduct(input.productId());
        requireCapacity(slot, input.plannedQuantity());
        if (lines.existsByWorkOrderIdAndSlotIdAndProductId(order.getId(), slot.getId(), input.productId()))
            throw conflict(DUPLICATE_LINE, "this work order already plans that product for slot " + slot.getSlotCode());
        var line = new RestockLine();
        line.setWorkOrderId(order.getId());
        line.setMachineId(order.getMachineId());
        line.setSlotId(slot.getId());
        line.setProductId(input.productId());
        line.setPlannedQuantity(input.plannedQuantity());
        lines.saveAndFlush(line);
        // Read-only slot/product associations of a new or re-pointed line are only populated by a reload.
        entityManager.refresh(line);
        return line;
    }

    private void activeProduct(UUID productId) {
        Product product = products.findById(productId).orElseThrow(() -> new ResourceNotFoundException("Product not found"));
        if (product.getStatus() != ProductStatus.ACTIVE) throw conflict(PRODUCT_INACTIVE, "product " + product.getName() + " is not ACTIVE");
    }

    private static void requireCapacity(MachineSlot slot, int planned) {
        if (planned > slot.getCapacity())
            throw new BadRequestException("plannedQuantity " + planned + " exceeds the capacity " + slot.getCapacity() + " of slot " + slot.getSlotCode());
    }

    private RestockLine lockLine(WorkOrder order, UUID lineId) {
        RestockLine line = lines.findForUpdateById(lineId).orElseThrow(() -> new ResourceNotFoundException("Restock line not found"));
        if (!line.getWorkOrderId().equals(order.getId())) throw new ResourceNotFoundException("Restock line not found");
        return line;
    }

    static void requireRestock(WorkOrder order) {
        if (order.getType() != WorkOrderType.RESTOCK) throw new BadRequestException("restock lines are only for RESTOCK work orders");
    }

    static ConflictException conflict(String code, String message) {
        return new ConflictException(code + ": " + message);
    }

    private static boolean has(String authority) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }
}
