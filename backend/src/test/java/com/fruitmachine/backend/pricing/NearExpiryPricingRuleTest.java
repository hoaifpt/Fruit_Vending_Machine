package com.fruitmachine.backend.pricing;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.config.properties.BusinessProperties;
import com.fruitmachine.backend.order.service.OrderCodeGenerator;
import com.fruitmachine.backend.pricing.enums.DiscountReason;
import com.fruitmachine.backend.pricing.model.BowlPrice;
import com.fruitmachine.backend.pricing.model.DiscountSetting;
import com.fruitmachine.backend.pricing.service.NearExpiryPricingService;
import com.fruitmachine.backend.product.entity.Product;
import com.fruitmachine.backend.product.entity.ProductBatch;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Issue #61 §8–§9: business zone, order code day and the near-expiry rule, with fixed clocks (no Spring, no database). */
class NearExpiryPricingRuleTest {
    // 13/11/2026 12:00 in Vietnam (UTC+7).
    static final Instant NOON_VN = Instant.parse("2026-11-13T05:00:00Z");
    static final BusinessCalendar CALENDAR = calendar(NOON_VN);
    static final NearExpiryPricingService PRICING = new NearExpiryPricingService(CALENDAR);
    static final DiscountSetting FIFTY = new DiscountSetting(true, 50);

    static BusinessCalendar calendar(Instant at) {
        return new BusinessCalendar(Clock.fixed(at, ZoneOffset.UTC), new BusinessProperties("Asia/Ho_Chi_Minh"));
    }

    static Product product(String price) {
        var product = new Product();
        product.setPrice(new BigDecimal(price));
        return product;
    }

    static ProductBatch batch(String expiresAt) {
        var batch = new ProductBatch();
        batch.setExpiresAt(Instant.parse(expiresAt));
        return batch;
    }

    static BowlPrice price(String productPrice, String expiresAt, DiscountSetting setting) {
        return PRICING.priceFor(product(productPrice), batch(expiresAt), NOON_VN, setting);
    }

    @Configuration
    @EnableConfigurationProperties(BusinessProperties.class)
    static class Binding { }

    @Test
    void anInvalidBusinessZoneStopsStartup() {
        new ApplicationContextRunner().withUserConfiguration(Binding.class).withPropertyValues("app.business-zone=Mars/Olympus")
                .run(context -> assertThat(context).hasFailed().getFailure().rootCause().hasMessageContaining("app.business-zone is not a valid time zone id"));
        new ApplicationContextRunner().withUserConfiguration(Binding.class)
                .run(context -> assertThat(context.getBean(BusinessProperties.class).zone().getId()).isEqualTo("Asia/Ho_Chi_Minh"));
    }

    @Test
    void orderCodesCarryTheVietnameseBusinessDay() {
        // 13/11 01:00 in Vietnam is still 12/11 in UTC.
        assertThat(new OrderCodeGenerator(Clock.fixed(Instant.parse("2026-11-12T18:00:00Z"), ZoneOffset.UTC), CALENDAR).generate())
                .matches("ORD-20261113-[0-9A-HJKMNP-TV-Z]{8}");
        // 13/11 23:30 in Vietnam.
        assertThat(new OrderCodeGenerator(Clock.fixed(Instant.parse("2026-11-13T16:30:00Z"), ZoneOffset.UTC), CALENDAR).generate())
                .startsWith("ORD-20261113-");
        // 14/11 00:00 in Vietnam is the next day.
        assertThat(new OrderCodeGenerator(Clock.fixed(Instant.parse("2026-11-13T17:00:00Z"), ZoneOffset.UTC), CALENDAR).generate())
                .startsWith("ORD-20261114-");
    }

    @Test
    void theCalendarSplitsDaysInTheBusinessZone() {
        assertThat(CALENDAR.today()).isEqualTo(LocalDate.of(2026, 11, 13));
        assertThat(CALENDAR.dayStart(LocalDate.of(2026, 11, 13))).isEqualTo(Instant.parse("2026-11-12T17:00:00Z"));
        assertThat(CALENDAR.dayEnd(LocalDate.of(2026, 11, 13))).isEqualTo(Instant.parse("2026-11-13T17:00:00Z"));
        var window = PRICING.window(NOON_VN, FIFTY);
        assertThat(window.covers(Instant.parse("2026-11-12T17:00:00Z"))).isTrue();
        assertThat(window.covers(Instant.parse("2026-11-13T16:59:59.999999Z"))).isTrue();
        assertThat(window.covers(Instant.parse("2026-11-13T17:00:00Z"))).isFalse();
        assertThat(PRICING.window(NOON_VN, new DiscountSetting(false, 50)).covers(Instant.parse("2026-11-13T10:00:00Z"))).isFalse();
    }

    @Test
    void aBowlExpiringTodayCostsTheDiscountRoundedDownToWholeDong() {
        // 13/11 18:00 Vietnam.
        String today = "2026-11-13T11:00:00Z";
        var half = price("35000", today, FIFTY);
        assertThat(half.unitPrice()).isEqualByComparingTo("17500");
        assertThat(half.originalPrice()).isEqualByComparingTo("35000");
        assertThat(half.discountPercent()).isEqualTo(50);
        assertThat(half.reason()).isEqualTo(DiscountReason.NEAR_EXPIRY);
        assertThat(half.discountAmount()).isEqualByComparingTo("17500");
        assertThat(price("25001", today, FIFTY).unitPrice()).isEqualByComparingTo("12500");
        assertThat(price("35000", today, new DiscountSetting(true, 30)).unitPrice()).isEqualByComparingTo("24500");
        assertThat(price("35000", today, new DiscountSetting(true, 90)).unitPrice()).isEqualByComparingTo("3500");
        assertThat(price("35000.99", today, new DiscountSetting(true, 1)).unitPrice()).isEqualByComparingTo("34650");
        assertThat(price("0", today, FIFTY).unitPrice()).isEqualByComparingTo("0");
        assertThat(price("1", today, new DiscountSetting(true, 90)).unitPrice()).isEqualByComparingTo("0").isNotNegative();
        assertThat(half.unitPrice().scale()).isEqualTo(2);
    }

    @Test
    void otherDaysAndADisabledSettingCostTheFullPrice() {
        // 14/11 00:00:01 Vietnam: tomorrow.
        var tomorrow = price("35000", "2026-11-13T17:00:01Z", FIFTY);
        assertThat(tomorrow.unitPrice()).isEqualByComparingTo("35000");
        assertThat(tomorrow.discountPercent()).isZero();
        assertThat(tomorrow.reason()).isEqualTo(DiscountReason.NONE);
        assertThat(tomorrow.discountAmount()).isEqualByComparingTo("0");
        // Disabled: no discount even today.
        assertThat(price("35000", "2026-11-13T11:00:00Z", new DiscountSetting(false, 50)).reason()).isEqualTo(DiscountReason.NONE);
    }

    @Test
    void theDayBoundaryIsTheBusinessZoneNotUtc() {
        // 13/11 01:30 Vietnam = 12/11 18:30 UTC: today in Vietnam although the UTC date is the 12th.
        assertThat(price("35000", "2026-11-12T18:30:00Z", FIFTY).reason()).isEqualTo(DiscountReason.NEAR_EXPIRY);
        // 14/11 00:30 Vietnam = 13/11 17:30 UTC: tomorrow in Vietnam although the UTC date is the 13th.
        assertThat(price("35000", "2026-11-13T17:30:00Z", FIFTY).reason()).isEqualTo(DiscountReason.NONE);
        // Late in the Vietnamese evening (13/11 23:30) the same rule holds.
        var lateCalendar = calendar(Instant.parse("2026-11-13T16:30:00Z"));
        var late = new NearExpiryPricingService(lateCalendar).priceFor(product("35000"), batch("2026-11-13T16:45:00Z"), Instant.parse("2026-11-13T16:30:00Z"), FIFTY);
        assertThat(late.unitPrice()).isEqualByComparingTo("17500");
    }

    @Test
    void percentsOutsideOneToNinetyAreNotASetting() {
        assertThatThrownBy(() -> new DiscountSetting(true, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new DiscountSetting(true, 91)).isInstanceOf(IllegalArgumentException.class);
    }
}
