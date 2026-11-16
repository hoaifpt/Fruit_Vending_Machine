package com.fruitmachine.backend.inventory.service;

import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.entity.InventoryTransaction;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.inventory.enums.InventoryTransactionType;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.inventory.repository.InventoryTransactionRepository;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.product.entity.ProductBatch;
import com.fruitmachine.backend.user.entity.User;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The loading core shared by direct loading (InventoryService) and restock work orders (#68). The caller already holds the locks
 * in the global loading order Product -> Batch -> Machine -> Slot and checked its own status rules; this checks capacity and the
 * batch's declared quantity, then creates the bowls (AVAILABLE) with one LOAD history row each.
 */
@Component
@RequiredArgsConstructor
public class InventoryLoader {
    public static final Set<InventoryStatus> PHYSICAL = EnumSet.of(InventoryStatus.AVAILABLE, InventoryStatus.RESERVED, InventoryStatus.EXPIRED,
            InventoryStatus.DISPENSE_FAILED);
    public static final String SLOT_CAPACITY_EXCEEDED = "SLOT_CAPACITY_EXCEEDED";
    public static final String BATCH_QUANTITY_EXCEEDED = "BATCH_QUANTITY_EXCEEDED";

    private final InventoryItemRepository items;
    private final InventoryTransactionRepository history;

    /**
     * @param strictOrder give each bowl its own loaded_at (now + i microseconds), so the column's FIFO order is the loading order and
     *                    never a UUID tie-break
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<InventoryItem> load(ProductBatch batch, MachineSlot slot, UUID machineId, int quantity, User actor, UUID referenceId, String reason,
            Instant now, boolean strictOrder) {
        long occupied = items.countBySlotIdAndStatusIn(slot.getId(), PHYSICAL);
        if (occupied + quantity > slot.getCapacity()) throw new ConflictException(SLOT_CAPACITY_EXCEEDED + ": Slot capacity exceeded");
        if (items.countByBatchId(batch.getId()) + quantity > batch.getQuantity())
            throw new ConflictException(BATCH_QUANTITY_EXCEEDED + ": Batch declared quantity exceeded");
        var loaded = new ArrayList<InventoryItem>();
        for (int n = 0; n < quantity; n++) {
            var item = new InventoryItem();
            item.setBatch(batch);
            item.setSlot(slot);
            item.setStatus(InventoryStatus.AVAILABLE);
            item.setLoadedAt(strictOrder ? now.plusNanos(1000L * n) : now);
            loaded.add(item);
        }
        items.saveAllAndFlush(loaded);
        for (var item : loaded) {
            var event = new InventoryTransaction();
            event.setInventoryItem(item);
            event.setMachineId(machineId);
            event.setSlotId(slot.getId());
            event.setType(InventoryTransactionType.LOAD);
            event.setReferenceId(referenceId);
            event.setPerformedBy(actor);
            event.setReason(reason);
            event.setStatusAfter(InventoryStatus.AVAILABLE);
            history.save(event);
        }
        history.flush();
        return loaded;
    }
}
