package com.fruitmachine.backend.order;

import com.fruitmachine.backend.config.properties.OrderProperties;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OrderPropertiesTest {
    private OrderProperties bind(Map<String, String> overrides) {
        var values = new HashMap<String, String>();
        values.put("app.order.max-total-quantity", "5");
        values.putAll(overrides);
        return new Binder(new MapConfigurationPropertySource(values)).bind("app.order", OrderProperties.class).get();
    }

    @Test
    void defaultsMatchTheDocumentedConfiguration() {
        var properties = bind(Map.of());
        assertThat(properties.reservationTtl()).isEqualTo(Duration.ofMinutes(5));
        assertThat(properties.maxTotalQuantity()).isEqualTo(5);
        assertThat(properties.expirySweep().enabled()).isTrue();
        assertThat(properties.expirySweep().interval()).isEqualTo(Duration.ofSeconds(30));
        assertThat(properties.expirySweep().batchSize()).isEqualTo(50);
    }

    @Test
    void invalidValuesFailBinding() {
        for (var invalid : java.util.List.of(
                Map.of("app.order.reservation-ttl", "PT0S"), Map.of("app.order.reservation-ttl", "-PT1M"),
                Map.of("app.order.max-total-quantity", "0"), Map.of("app.order.expiry-sweep.interval", "PT0S"),
                Map.of("app.order.expiry-sweep.interval", "-PT5S"), Map.of("app.order.expiry-sweep.batch-size", "0"))) {
            assertThatThrownBy(() -> bind(invalid)).as("%s", invalid).isInstanceOf(RuntimeException.class);
        }
    }
}
