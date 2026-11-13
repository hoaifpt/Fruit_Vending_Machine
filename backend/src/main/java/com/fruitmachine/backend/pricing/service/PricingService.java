package com.fruitmachine.backend.pricing.service;

import com.fruitmachine.backend.pricing.model.BowlPrice;
import com.fruitmachine.backend.pricing.model.DiscountSetting;
import com.fruitmachine.backend.pricing.model.NearExpiryWindow;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.entity.ProductBatch;
import java.time.Instant;

/** The single pricing rule (issue #61). Pure: time and setting are passed in. */
public interface PricingService {
    BowlPrice priceFor(Product product, ProductBatch batch, Instant at, DiscountSetting setting);

    /** Today's eligibility bounds at {@code at}, for the catalog query and inventory flags. */
    NearExpiryWindow window(Instant at, DiscountSetting setting);
}
