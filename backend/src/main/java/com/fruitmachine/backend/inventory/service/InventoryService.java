package com.fruitmachine.backend.inventory.service;

import com.fruitmachine.backend.common.exception.*;
import com.fruitmachine.backend.inventory.dto.*;
import com.fruitmachine.backend.inventory.entity.*;
import com.fruitmachine.backend.inventory.enums.*;
import com.fruitmachine.backend.inventory.mapper.InventoryMapper;
import com.fruitmachine.backend.inventory.repository.*;
import com.fruitmachine.backend.machine.enums.*;
import com.fruitmachine.backend.machine.repository.*;
import com.fruitmachine.backend.product.batch.repository.ProductBatchRepository;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.repository.ProductRepository;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import jakarta.validation.Valid;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

@Service @RequiredArgsConstructor @Validated
@PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
public class InventoryService {
    private static final Set<InventoryStatus> PHYSICAL = Set.of(InventoryStatus.AVAILABLE, InventoryStatus.RESERVED, InventoryStatus.EXPIRED, InventoryStatus.DISPENSE_FAILED);
    private final InventoryItemRepository items;
    private final InventoryTransactionRepository history;
    private final ProductBatchRepository batches;
    private final ProductRepository products;
    private final MachineRepository machines;
    private final MachineSlotRepository slots;
    private final UserRepository users;
    private final InventoryMapper mapper;
    private final Clock clock;

    @Transactional
    public InventoryLoadResponse loadInventory(@Valid LoadInventoryRequest request) {
        // Scalar lookup avoids managed stale snapshots before acquiring locks.
        UUID productId = batches.findProductIdById(request.batchId()).orElseThrow(() -> missing("Product batch"));
        UUID machineId = slots.findMachineIdById(request.slotId()).orElseThrow(() -> missing("Machine slot"));
        // One global order for loading: Product -> Batch -> Machine -> Slot -> new Items.
        var product = products.findForUpdateById(productId).orElseThrow(() -> missing("Product"));
        var batch = batches.findForUpdateById(request.batchId()).orElseThrow(() -> missing("Product batch"));
        var machine = machines.findForUpdateById(machineId).orElseThrow(() -> missing("Machine"));
        var slot = slots.findForUpdateById(request.slotId()).orElseThrow(() -> missing("Machine slot"));
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (product.getStatus() != ProductStatus.ACTIVE) throw new ConflictException("Product must be ACTIVE");
        if (!batch.getExpiresAt().isAfter(now)) throw new ConflictException("Batch is expired");
        if (machine.getStatus() == MachineStatus.INACTIVE) throw new ConflictException("Machine must be ACTIVE or MAINTENANCE for loading");
        if (slot.getStatus() != SlotStatus.ACTIVE) throw new ConflictException("Slot must be ACTIVE for loading");
        long occupied = items.countBySlotIdAndStatusIn(slot.getId(), PHYSICAL);
        if (occupied + request.quantity() > slot.getCapacity()) throw new ConflictException("Slot capacity exceeded");
        if (items.countByBatchId(batch.getId()) + request.quantity() > batch.getQuantity()) throw new ConflictException("Batch declared quantity exceeded");
        User actor = actor(); UUID operation = UUID.randomUUID();
        var loaded = new ArrayList<InventoryItem>();
        for (int n = 0; n < request.quantity(); n++) {
            var item = new InventoryItem(); item.setBatch(batch); item.setSlot(slot);
            item.setStatus(InventoryStatus.AVAILABLE); item.setLoadedAt(now); loaded.add(item);
        }
        items.saveAllAndFlush(loaded);
        for (var item : loaded) append(item, machineId, slot.getId(), InventoryTransactionType.LOAD, operation, actor, null, null, InventoryStatus.AVAILABLE);
        history.flush();
        return new InventoryLoadResponse(operation, loaded.size(), loaded.stream().map(item -> mapper.item(item, now)).toList());
    }
    @Transactional
    public InventoryItemResponse removeInventoryItem(UUID id, @Valid RemoveInventoryRequest request) {
        UUID slotId = items.findSlotIdById(id);
        // Removal only takes Slot -> Item locks; it cannot form a cycle with loading.
        if (slotId != null) slots.findForUpdateById(slotId).orElseThrow(() -> missing("Machine slot"));
        var item = items.findForUpdateById(id).orElseThrow(() -> missing("Inventory item"));
        InventoryStatus before = item.getStatus();
        if (before != InventoryStatus.AVAILABLE && before != InventoryStatus.EXPIRED)
            throw new ConflictException("Only AVAILABLE or EXPIRED items may be removed; other states require reconciliation");
        User actor = actor(); Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        item.setStatus(InventoryStatus.REMOVED); item.setRemovedAt(now);
        var slot = item.getSlot();
        append(item, slot == null ? null : slot.getMachine().getId(), slotId, InventoryTransactionType.REMOVE,
                UUID.randomUUID(), actor, request.reason(), before, InventoryStatus.REMOVED);
        items.flush(); history.flush();
        return mapper.item(item, now);
    }
    private User actor() {
        var principal = (AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        return users.findById(principal.getId()).orElseThrow(() -> missing("Actor"));
    }
    private void append(InventoryItem item, UUID machineId, UUID slotId, InventoryTransactionType type, UUID reference,
            User actor, String reason, InventoryStatus before, InventoryStatus after) {
        var event = new InventoryTransaction(); event.setInventoryItem(item); event.setMachineId(machineId); event.setSlotId(slotId);
        event.setType(type); event.setReferenceId(reference); event.setPerformedBy(actor);
        event.setReason(reason); event.setStatusBefore(before); event.setStatusAfter(after); history.save(event);
    }
    @Transactional(readOnly = true)
    public InventoryItemResponse getInventoryItem(UUID id) {
        return mapper.item(items.findById(id).orElseThrow(() -> missing("Inventory item")), clock.instant());
    }
    @Transactional(readOnly = true)
    public InventoryPageResponse listInventory(int page, int size, UUID machineId, UUID slotId, UUID batchId, InventoryStatus status, Boolean expired, String sort) {
        Instant now = clock.instant();
        Specification<InventoryItem> filter = (root, query, cb) -> {
            var predicates = new ArrayList<jakarta.persistence.criteria.Predicate>();
            if (machineId != null) predicates.add(cb.equal(root.get("slot").get("machine").get("id"), machineId));
            if (slotId != null) predicates.add(cb.equal(root.get("slotId"), slotId));
            if (batchId != null) predicates.add(cb.equal(root.get("batch").get("id"), batchId));
            if (status != null) predicates.add(cb.equal(root.get("status"), status));
            if (expired != null) predicates.add(expired ? cb.lessThanOrEqualTo(root.get("batch").get("expiresAt"), now) : cb.greaterThan(root.get("batch").get("expiresAt"), now));
            return cb.and(predicates.toArray(jakarta.persistence.criteria.Predicate[]::new));
        };
        var result = items.findAll(filter, page(page, size, sort, Set.of("id", "status", "loadedAt", "createdAt", "updatedAt")));
        return new InventoryPageResponse(result.getContent().stream().map(item -> mapper.item(item, now)).toList(), page, size, result.getTotalElements(), result.getTotalPages());
    }
    @Transactional(readOnly = true)
    public InventoryPageResponse getMachineInventory(UUID machineId, int page, int size, InventoryStatus status, Boolean expired) {
        if (!machines.existsById(machineId)) throw missing("Machine");
        return listInventory(page, size, machineId, null, null, status, expired, null);
    }
    @Transactional(readOnly = true)
    public InventoryPageResponse getSlotInventory(UUID machineId, UUID slotId, int page, int size, InventoryStatus status, Boolean expired) {
        requireSlot(machineId, slotId);
        return listInventory(page, size, machineId, slotId, null, status, expired, null);
    }
    @Transactional(readOnly = true)
    public InventorySummaryResponse getInventorySummary(UUID machineId, UUID slotId) {
        requireSlot(machineId, slotId); Instant now = clock.instant();
        var counts = items.counts(slotId, now, PHYSICAL, InventoryStatus.AVAILABLE, InventoryStatus.EXPIRED, InventoryStatus.RESERVED, ProductStatus.ACTIVE);
        // Capacity, eligibility and item counts share one database statement snapshot.
        boolean eligible = counts.getSlotStatus() == SlotStatus.ACTIVE && counts.getMachineStatus() == MachineStatus.ACTIVE;
        return new InventorySummaryResponse(machineId, slotId, counts.getCapacity(), counts.getOccupied(), counts.getAvailable(), counts.getExpired(), counts.getReserved(),
                eligible ? counts.getActiveProductAvailable() : 0, Math.max(0L, counts.getCapacity() - counts.getOccupied()), now);
    }
    private com.fruitmachine.backend.machine.entity.MachineSlot requireSlot(UUID machineId, UUID slotId) {
        if (!machines.existsById(machineId)) throw missing("Machine");
        return slots.findByIdAndMachineId(slotId, machineId).orElseThrow(() -> missing("Slot in specified machine"));
    }
    @Transactional(readOnly = true)
    public InventoryTransactionPageResponse listInventoryTransactions(int page, int size, UUID itemId, UUID machineId, UUID slotId, UUID referenceId, InventoryTransactionType type) {
        Specification<InventoryTransaction> filter = (root, query, cb) -> {
            var predicates = new ArrayList<jakarta.persistence.criteria.Predicate>();
            if (itemId != null) predicates.add(cb.equal(root.get("inventoryItem").get("id"), itemId));
            if (machineId != null) predicates.add(cb.equal(root.get("machineId"), machineId));
            if (slotId != null) predicates.add(cb.equal(root.get("slotId"), slotId));
            if (referenceId != null) predicates.add(cb.equal(root.get("referenceId"), referenceId));
            if (type != null) predicates.add(cb.equal(root.get("type"), type));
            return cb.and(predicates.toArray(jakarta.persistence.criteria.Predicate[]::new));
        };
        var result = history.findAll(filter, page(page, size, null, Set.of("createdAt")));
        return new InventoryTransactionPageResponse(result.getContent().stream().map(mapper::transaction).toList(), page, size, result.getTotalElements(), result.getTotalPages());
    }
    private PageRequest page(int page, int size, String input, Set<String> fields) {
        if (page < 0 || size < 1 || size > 100) throw new BadRequestException("Page must be nonnegative and size between 1 and 100");
        String[] parts = (input == null ? "createdAt,desc" : input).split(",", -1);
        if (parts.length > 2 || !fields.contains(parts[0]) || (parts.length == 2 && !Set.of("asc", "desc").contains(parts[1].toLowerCase(Locale.ROOT)))) throw new BadRequestException("Invalid inventory sort");
        Sort sort = Sort.by(parts.length == 2 && parts[1].equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC, parts[0]);
        return PageRequest.of(page, size, parts[0].equals("id") ? sort : sort.and(Sort.by("id")));
    }
    private ResourceNotFoundException missing(String name) { return new ResourceNotFoundException(name + " not found"); }
}
