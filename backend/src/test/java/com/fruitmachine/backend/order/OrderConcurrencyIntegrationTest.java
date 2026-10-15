package com.fruitmachine.backend.order;

import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.sql.Connection;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

/** Real PostgreSQL transactions on separate threads and connections; no mocks, no outer test transaction. */
class OrderConcurrencyIntegrationTest extends AbstractOrderIntegrationTest {
    private record Shop(UUID machineId, UUID slotId, UUID productId, String key) {}

    private Shop shop(int bowls) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID slot = createSlot(machine, "C1", 30), product = createProduct("Race bowl", "10000");
        load(fixtures.batch(product, bowls, staff.token()), slot, bowls);
        return new Shop(machine, slot, product, issueKey(machine));
    }

    private List<Integer> parallel(List<Callable<Integer>> tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        try {
            CountDownLatch ready = new CountDownLatch(tasks.size()), go = new CountDownLatch(1);
            List<Future<Integer>> futures = new ArrayList<>();
            for (Callable<Integer> task : tasks) {
                futures.add(pool.submit(() -> { ready.countDown(); go.await(); return task.call(); }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            go.countDown();
            List<Integer> results = new ArrayList<>();
            for (Future<Integer> future : futures) results.add(future.get(60, TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private Callable<Integer> create(Shop shop, int quantity) {
        return () -> kioskCall("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), quantity))).getResponse().getStatus();
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    @Test
    void twoConcurrentOrdersForTheLastBowlYieldExactlyOneCreatedAndOneConflict() throws Exception {
        for (int round = 0; round < 3; round++) {
            Shop shop = shop(1);
            var statuses = parallel(List.of(create(shop, 1), create(shop, 1)));
            assertThat(statuses).containsExactlyInAnyOrder(201, 409);
            assertThat(count("SELECT count(*) FROM orders WHERE machine_id=?", shop.machineId())).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", shop.slotId())).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM order_item_allocations a JOIN inventory_items i ON i.id=a.inventory_item_id WHERE i.slot_id=? AND a.status='RESERVED'", shop.slotId())).isEqualTo(1);
        }
    }

    @Test
    void concurrentOrdersForNBowlsNeverOverReserveOrShareABowl() throws Exception {
        Shop shop = shop(4);
        var statuses = parallel(java.util.stream.IntStream.range(0, 8).mapToObj(i -> create(shop, 1)).toList());
        assertThat(statuses.stream().filter(s -> s == 201).count()).isEqualTo(4);
        assertThat(statuses.stream().filter(s -> s == 409).count()).isEqualTo(4);
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", shop.slotId())).isEqualTo(4);
        assertThat(count("SELECT count(DISTINCT a.inventory_item_id) FROM order_item_allocations a JOIN inventory_items i ON i.id=a.inventory_item_id WHERE i.slot_id=? AND a.status='RESERVED'", shop.slotId())).isEqualTo(4);
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE type='RESERVE' AND slot_id=?", shop.slotId())).isEqualTo(4);
    }

    @Test
    void orderRacingWithRemovalOfTheSameBowlLeavesOneConsistentOutcome() throws Exception {
        for (int round = 0; round < 3; round++) {
            Shop shop = shop(1);
            UUID item = jdbc.queryForObject("SELECT id FROM inventory_items WHERE slot_id=?", UUID.class, shop.slotId());
            var statuses = parallel(List.of(create(shop, 1), () -> {
                var req = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/v1/inventory/" + item + "/remove")
                        .header("Authorization", "Bearer " + staff.token()).contentType("application/json").content("{\"reason\":\"Race removal\"}");
                return mvc.perform(req).andReturn().getResponse().getStatus();
            }));
            String finalStatus = jdbc.queryForObject("SELECT status FROM inventory_items WHERE id=?", String.class, item);
            long orders = count("SELECT count(*) FROM orders WHERE machine_id=?", shop.machineId());
            long allocations = count("SELECT count(*) FROM order_item_allocations WHERE inventory_item_id=?", item);
            if (statuses.get(0) == 201) {
                assertThat(statuses.get(1)).isEqualTo(409);
                assertThat(finalStatus).isEqualTo("RESERVED");
                assertThat(orders).isEqualTo(1);
                assertThat(allocations).isEqualTo(1);
            } else {
                assertThat(statuses).containsExactly(409, 200);
                assertThat(finalStatus).isEqualTo("REMOVED");
                assertThat(orders).isZero();
                assertThat(allocations).isZero();
            }
        }
    }

    @Test
    void orderBlockedBehindAProductDeactivationNeverReservesTheInactiveProduct() throws Exception {
        Shop shop = shop(2);
        try (Connection deactivation = dataSource.getConnection()) {
            deactivation.setAutoCommit(false);
            try (var lock = deactivation.prepareStatement("SELECT id FROM products WHERE id=? FOR UPDATE")) {
                lock.setObject(1, shop.productId());
                lock.executeQuery().close();
            }
            ExecutorService pool = Executors.newSingleThreadExecutor();
            try {
                Future<Integer> order = pool.submit(create(shop, 1));
                awaitBlockedStatement();
                assertThat(order.isDone()).isFalse();
                try (var update = deactivation.prepareStatement("UPDATE products SET status='INACTIVE' WHERE id=?")) {
                    update.setObject(1, shop.productId());
                    update.executeUpdate();
                }
                deactivation.commit();
                assertThat(order.get(30, TimeUnit.SECONDS)).isEqualTo(409);
            } finally {
                pool.shutdownNow();
            }
        }
        assertThat(count("SELECT count(*) FROM orders WHERE machine_id=?", shop.machineId())).isZero();
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", shop.slotId())).isZero();
    }

    @Test
    void deactivationWaitsForAnInFlightOrderThatHoldsTheSharedProductLock() throws Exception {
        Shop shop = shop(2);
        try (Connection reservation = dataSource.getConnection()) {
            reservation.setAutoCommit(false);
            try (var lock = reservation.prepareStatement("SELECT id FROM products WHERE id=? FOR SHARE")) {
                lock.setObject(1, shop.productId());
                lock.executeQuery().close();
            }
            ExecutorService pool = Executors.newSingleThreadExecutor();
            try {
                Future<Integer> deactivate = pool.submit(() -> mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/products/" + shop.productId() + "/status").header("Authorization", "Bearer " + admin.token())
                        .contentType("application/json").content("{\"status\":\"INACTIVE\"}")).andReturn().getResponse().getStatus());
                awaitBlockedStatement();
                assertThat(deactivate.isDone()).isFalse();
                reservation.commit();
                assertThat(deactivate.get(30, TimeUnit.SECONDS)).isEqualTo(200);
            } finally {
                pool.shutdownNow();
            }
        }
        assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?", String.class, shop.productId())).isEqualTo("INACTIVE");
    }

    @Test
    void cancelRacingWithTheExpirySweepReleasesEachOrderExactlyOnce() throws Exception {
        for (int round = 0; round < 4; round++) {
            Shop shop = shop(3);
            UUID order = UUID.fromString(kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), 3)), 201).path("id").asText());
            clock.advance(Duration.ofMinutes(10));
            var statuses = parallel(List.of(
                    () -> kioskCall("POST", "/api/v1/kiosk/orders/" + order + "/cancel", shop.key(), null).getResponse().getStatus(),
                    () -> expiry.sweep()));
            assertThat(statuses.get(0)).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, order)).isEqualTo("CANCELLED");
            assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", order)).isEqualTo(3);
            assertThat(count("SELECT count(*) FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=? AND a.status='RELEASED'", order)).isEqualTo(3);
            assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='AVAILABLE'", shop.slotId())).isEqualTo(3);
            assertThat(jdbc.queryForObject("SELECT reason FROM inventory_transactions WHERE reference_id=? AND type='RETURN' LIMIT 1", String.class, order))
                    .isIn("ORDER_CANCELLED", "RESERVATION_EXPIRED");
            clock.reset();
        }
    }

    /** Polls pg_stat_activity until a statement of this database waits for a lock. */
    private void awaitBlockedStatement() throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (System.nanoTime() < deadline) {
            Long waiting = jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'", Long.class);
            if (waiting != null && waiting > 0) return;
            Thread.sleep(50);
        }
        throw new AssertionError("No statement became blocked on a lock");
    }
}
