package com.fruitmachine.backend.inventory.service;

import com.fruitmachine.backend.pricing.enums.DiscountReason;
import com.fruitmachine.backend.pricing.service.PricingService;
import com.fruitmachine.backend.pricing.service.PricingSettingsService;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.config.properties.OrderProperties;
import com.fruitmachine.backend.inventory.dto.KioskCatalogProductResponse;
import com.fruitmachine.backend.inventory.dto.KioskCatalogResponse;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@EnableConfigurationProperties(OrderProperties.class)
@PreAuthorize("hasRole('KIOSK')")
public class KioskCatalogService {
    private final InventoryItemRepository items;
    private final MachineRepository machines;
    private final OrderProperties properties;
    private final PricingService pricing;
    private final PricingSettingsService pricingSettings;
    private final Clock clock;

    @Transactional(readOnly = true)
    public KioskCatalogResponse catalog(AuthenticatedKiosk kiosk) {
        var machine = machines.findById(kiosk.machineId()).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        boolean accepting = machine.getStatus() == MachineStatus.ACTIVE;
        // Same rule as reservation: only a sellable slot head that outlives the hold deadline makes a product orderable.
        Instant now = clock.instant();
        Instant holdDeadline = now.plus(properties.reservationTtl()).truncatedTo(ChronoUnit.MICROS);
        List<KioskCatalogProductResponse> products = List.of();
        if (accepting) {
            // Issue #61: setting read once per request; today's bounds in the business zone are query parameters.
            var window = pricing.window(now, pricingSettings.current());
            products = items.findCatalog(machine.getId(), holdDeadline, window.enabled(), window.percent(), window.dayStart(), window.dayEnd()).stream()
                    .map(row -> new KioskCatalogProductResponse(row.getProductId(), row.getSku(), row.getName(), row.getDescription(),
                            row.getPrice(), row.getOriginalPrice(), row.getDiscountPercent(), DiscountReason.valueOf(row.getDiscountReason()),
                            row.getImageUrl(), row.getAvailableQuantity()))
                    .toList();
        }
        return new KioskCatalogResponse(machine.getId(), machine.getCode(), accepting, products);
    }
}
