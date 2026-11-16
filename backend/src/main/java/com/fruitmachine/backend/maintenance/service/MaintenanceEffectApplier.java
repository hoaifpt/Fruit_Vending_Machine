package com.fruitmachine.backend.maintenance.service;

import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.entity.InventoryTransaction;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.inventory.enums.InventoryTransactionType;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.inventory.repository.InventoryTransactionRepository;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.repository.MachineSlotRepository;
import com.fruitmachine.backend.maintenance.entity.MaintenanceCommand;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a COMPLETED (or reconciled DONE) command did to the column (issue #64 §4). Lock order Slot, then InventoryItems in id order.
 * Bowls become REMOVED with one REMOVE history row each (reference = command id, actor = requester); items are never deleted,
 * batch quantities never change, machine and slot status never change.
 */
@Component
@RequiredArgsConstructor
public class MaintenanceEffectApplier {
    /** Bowls a maintenance action may take out: present in the column and not promised to a customer. */
    public static final Set<InventoryStatus> REMOVABLE = EnumSet.of(InventoryStatus.AVAILABLE, InventoryStatus.EXPIRED, InventoryStatus.DISPENSE_FAILED);
    static final Set<InventoryStatus> PHYSICAL = EnumSet.of(InventoryStatus.AVAILABLE, InventoryStatus.RESERVED, InventoryStatus.EXPIRED,
            InventoryStatus.DISPENSE_FAILED);

    public enum Result { APPLIED, HEAD_CHANGED }

    private final MachineSlotRepository slots;
    private final InventoryItemRepository items;
    private final InventoryTransactionRepository history;

    @Transactional(propagation = Propagation.MANDATORY)
    public Result apply(MaintenanceCommand command, Instant now) {
        return switch (command.getOperation()) {
            case REMOVE_ITEM -> removeHead(command, lockSlot(command), now);
            case EMPTY_COLUMN -> empty(command, lockSlot(command), now);
            case OPEN_REFILL -> gate(lockSlot(command), true);
            case CLOSE_REFILL -> gate(lockSlot(command), false);
            case RESET -> Result.APPLIED;
        };
    }

    private MachineSlot lockSlot(MaintenanceCommand command) {
        return slots.findForUpdateByIdAndMachineId(command.getSlotId(), command.getMachineId()).orElseThrow();
    }

    /** Only the bowl that was the head when the command was created, and only if it still is the head and removable. */
    private Result removeHead(MaintenanceCommand command, MachineSlot slot, Instant now) {
        List<InventoryItem> heads = items.findHeadCandidates(slot.getId(), PHYSICAL, PageRequest.of(0, 1));
        if (heads.isEmpty() || !heads.getFirst().getId().equals(command.getTargetInventoryItemId())) return Result.HEAD_CHANGED;
        InventoryItem head = items.findForUpdateById(command.getTargetInventoryItemId()).orElseThrow();
        if (!REMOVABLE.contains(head.getStatus())) return Result.HEAD_CHANGED;
        remove(command, slot, head, now);
        command.setRemovedCount(1);
        flush();
        return Result.APPLIED;
    }

    private Result empty(MaintenanceCommand command, MachineSlot slot, Instant now) {
        List<InventoryItem> bowls = items.findForUpdateBySlotIdAndStatusInOrderById(slot.getId(), REMOVABLE);
        for (InventoryItem bowl : bowls) remove(command, slot, bowl, now);
        command.setRemovedCount(bowls.size());
        flush();
        return Result.APPLIED;
    }

    private Result gate(MachineSlot slot, boolean open) {
        slot.setRefillGateOpen(open);
        slots.flush();
        return Result.APPLIED;
    }

    private void remove(MaintenanceCommand command, MachineSlot slot, InventoryItem bowl, Instant now) {
        InventoryStatus before = bowl.getStatus();
        bowl.setStatus(InventoryStatus.REMOVED);
        bowl.setRemovedAt(bowl.getLoadedAt() != null && now.isBefore(bowl.getLoadedAt()) ? bowl.getLoadedAt() : now);
        var event = new InventoryTransaction();
        event.setInventoryItem(bowl);
        event.setMachineId(slot.getMachineId() != null ? slot.getMachineId() : command.getMachineId());
        event.setSlotId(slot.getId());
        event.setType(InventoryTransactionType.REMOVE);
        event.setReferenceId(command.getId());
        event.setPerformedBy(command.getRequestedBy());
        event.setReason(historyReason(command));
        event.setStatusBefore(before);
        event.setStatusAfter(InventoryStatus.REMOVED);
        history.save(event);
    }

    /** e.g. "MAINTENANCE_REMOVE_ITEM DAMAGED: lid cracked"; at most 500 characters. */
    static String historyReason(MaintenanceCommand command) {
        String text = command.getOperation().commandType() + " " + command.getReason().name() + (command.getNote() == null ? "" : ": " + command.getNote());
        return text.length() > 500 ? text.substring(0, 500) : text;
    }

    private void flush() {
        items.flush();
        history.flush();
    }
}
