package com.fruitmachine.backend.restock.service;

import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.config.properties.HealthCheckProperties;
import com.fruitmachine.backend.config.properties.OrderProperties;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.restock.dto.RestockSuggestionResponse;
import com.fruitmachine.backend.restock.dto.RestockSuggestionResponse.Action;
import com.fruitmachine.backend.restock.repository.RestockQueries;
import com.fruitmachine.backend.security.permission.Permissions;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Per-slot restock suggestions (issue #68 §2) from one aggregate query. A column that holds an expired, failed, expiring-today or
 * blocking head bowl cannot be fixed by loading on top (FIFO: the bad bowl stays first): EMPTY_THEN_LOAD. A healthy column with
 * at most lowStockThreshold sellable bowls and room left: LOAD. Otherwise NONE.
 */
@Service
@RequiredArgsConstructor
@EnableConfigurationProperties({HealthCheckProperties.class, OrderProperties.class})
public class RestockSuggestionService {
    private final RestockQueries queries;
    private final MachineRepository machines;
    private final HealthCheckProperties health;
    private final OrderProperties orders;
    private final BusinessCalendar calendar;
    private final Clock clock;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_RESTOCK_PLAN)
    public RestockSuggestionResponse suggestions(UUID machineId) {
        return compute(machineId);
    }

    /** Same computation for internal callers (planning from suggestions); the caller has checked permissions. */
    @Transactional(readOnly = true)
    public RestockSuggestionResponse compute(UUID machineId) {
        var machine = machines.findById(machineId).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant hold = now.plus(orders.reservationTtl());
        Instant dayEnd = calendar.dayEnd(calendar.today(now));
        int threshold = health.lowStockThreshold();
        List<RestockSuggestionResponse.SlotSuggestion> slots = queries.slotStates(machineId, now, hold, dayEnd).stream().map(s -> {
            boolean active = "ACTIVE".equals(s.getSlotStatus());
            String head = s.getHeadStatus();
            if ("AVAILABLE".equals(head) && s.getHeadExpiresAt() != null && !s.getHeadExpiresAt().isAfter(now)) head = "EXPIRED";
            boolean headSellable = "AVAILABLE".equals(head) && s.getHeadExpiresAt() != null && s.getHeadExpiresAt().isAfter(hold);
            boolean headBlocks = head != null && !headSellable && !"RESERVED".equals(head);
            long sellable = headSellable && active && !s.getRefillGateOpen() ? s.getAvailable() : 0;
            int capacity = s.getCapacity();
            Action action;
            int load;
            if ("INACTIVE".equals(s.getSlotStatus())) {
                action = Action.NONE;
                load = 0;
            } else if (s.getExpired() > 0 || s.getFailed() > 0 || s.getExpiringToday() > 0 || headBlocks) {
                action = Action.EMPTY_THEN_LOAD;
                load = capacity;
            } else if (sellable > threshold || s.getPhysical() >= capacity) {
                action = Action.NONE;
                load = 0;
            } else {
                action = Action.LOAD;
                load = (int) (capacity - s.getPhysical());
            }
            var product = s.getProductId() == null ? null : new RestockSuggestionResponse.CurrentProduct(s.getProductId(), s.getProductName());
            List<String> alerts = s.getAlertTypes() == null ? List.of() : Arrays.asList(s.getAlertTypes().split(","));
            return new RestockSuggestionResponse.SlotSuggestion(s.getSlotId(), s.getSlotCode(), capacity, s.getSlotStatus(), s.getRefillGateOpen(),
                    s.getPhysical(), sellable, s.getExpired(), s.getExpiringToday(), s.getFailed(), head, product, action, load, alerts);
        }).toList();
        return new RestockSuggestionResponse(machineId, machine.getCode(), threshold, slots);
    }
}
