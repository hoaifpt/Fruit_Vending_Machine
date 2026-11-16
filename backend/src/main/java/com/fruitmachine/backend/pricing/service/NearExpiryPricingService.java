package com.fruitmachine.backend.pricing.service;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.pricing.enums.DiscountReason;
import com.fruitmachine.backend.pricing.model.BowlPrice;
import com.fruitmachine.backend.pricing.model.DiscountSetting;
import com.fruitmachine.backend.pricing.model.NearExpiryWindow;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.entity.ProductBatch;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * A bowl whose batch expires on the current business day (app.business-zone) costs
 * floor(original x (100 - percent) / 100) whole VND while the setting is enabled; any other bowl costs the product price.
 * InventoryItemRepository.findCatalog applies the same rule in SQL (window bounds and percent as parameters).
 */
@Service
@RequiredArgsConstructor
public class NearExpiryPricingService implements PricingService {
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private final BusinessCalendar calendar;

    @Override
    public BowlPrice priceFor(Product product, ProductBatch batch, Instant at, DiscountSetting setting) {
        BigDecimal original = product.getPrice().setScale(2, RoundingMode.UNNECESSARY);
        LocalDate today = calendar.today(at);
        LocalDate expiryDay = calendar.dayOf(batch.getExpiresAt());
        if (!setting.enabled() || !expiryDay.equals(today)) return new BowlPrice(original, original, 0, DiscountReason.NONE);
        return new BowlPrice(original, discounted(original, setting.percent()), setting.percent(), DiscountReason.NEAR_EXPIRY);
    }

    @Override
    public NearExpiryWindow window(Instant at, DiscountSetting setting) {
        LocalDate today = calendar.today(at);
        return new NearExpiryWindow(setting.enabled(), setting.percent(), calendar.dayStart(today), calendar.dayEnd(today));
    }

    /** Rounded down to whole VND (payOS charges whole VND only); never negative because percent is at most 90. */
    static BigDecimal discounted(BigDecimal original, int percent) {
        return original.multiply(BigDecimal.valueOf(100L - percent)).divide(HUNDRED, 0, RoundingMode.DOWN).setScale(2, RoundingMode.UNNECESSARY);
    }
}
