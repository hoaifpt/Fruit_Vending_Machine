package com.fruitmachine.backend.integration;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import com.fruitmachine.backend.support.TestDataFactory;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.locks.LockSupport;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

class InventoryConcurrentRequestsIntegrationTest extends AbstractCoreIntegrationTest {
    @Test
    void twoOverlappingLoadsFromFourOccupantsCannotExceedCapacitySix() throws Exception {
        var stock = fixtures.stock(20, 6, admin.token(), staff.token());
        fixtures.load(stock, 4, admin.token());
        assertThat(race(stock, stock.slotId(), stock.slotId())).containsExactlyInAnyOrder(201, 409);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE slot_id=?", Long.class, stock.slotId())).isEqualTo(6);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions WHERE machine_id=?", Long.class, stock.machineId())).isEqualTo(6);
        var summary = fixtures.api("GET", stock.slotInventory()+"/summary", null, staff.token(), 200);
        assertThat(summary.path("occupiedCount").asInt()).isEqualTo(6);
        assertThat(summary.path("remainingCapacity").asInt()).isZero();
    }

    @Test
    void twoOverlappingLoadsFromEighteenRegisteredItemsCannotExceedBatchTwenty() throws Exception {
        var stock = fixtures.stock(20, 20, admin.token(), staff.token());
        fixtures.load(stock, 18, staff.token());
        UUID otherMachine = fixtures.machine(admin.token());
        UUID otherSlot = fixtures.slot(otherMachine, 20, admin.token());
        assertThat(race(stock, stock.slotId(), otherSlot)).containsExactlyInAnyOrder(201, 409);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE batch_id=?", Long.class, stock.batchId())).isEqualTo(20);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_transactions h JOIN inventory_items i ON i.id=h.inventory_item_id WHERE i.batch_id=?", Long.class, stock.batchId())).isEqualTo(20);
        assertThat(jdbc.queryForObject("SELECT quantity FROM product_batches WHERE id=?", Integer.class, stock.batchId())).isEqualTo(20);
    }

    private List<Integer> race(TestDataFactory.Stock stock, UUID firstSlot, UUID secondSlot) throws Exception {
        var start = new CountDownLatch(1);
        // Hold the existing product lock until BOTH request transactions wait in PostgreSQL.
        // This proves overlap instead of hoping thread scheduling creates a race.
        try (var executor = Executors.newFixedThreadPool(2); var blocker = dataSource.getConnection()) {
            blocker.setAutoCommit(false);
            try (var lock = blocker.prepareStatement("SELECT id FROM products WHERE id=? FOR UPDATE")) {
                lock.setObject(1, stock.productId());
                try (var result = lock.executeQuery()) { assertThat(result.next()).isTrue(); }
            }
            var first = executor.submit(() -> loadRequest(stock.batchId(), firstSlot, admin.token(), start));
            var second = executor.submit(() -> loadRequest(stock.batchId(), secondSlot, staff.token(), start));
            start.countDown();
            try {
                awaitTwoWaitingTransactions();
            } finally {
                blocker.rollback();
            }
            return List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS));
        }
    }

    private int loadRequest(UUID batch, UUID slot, String token, CountDownLatch start) throws Exception {
        assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
        return mvc.perform(post("/api/v1/inventory/load").header("Authorization", "Bearer " + token)
                .contentType("application/json").content(json.writeValueAsString(TestDataFactory.loadBody(batch, slot, 2))))
                .andReturn().getResponse().getStatus();
    }

    private void awaitTwoWaitingTransactions() {
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        do {
            long waiting = jdbc.queryForObject("""
                    SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
                      AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%products%'
                    """, Long.class);
            if (waiting >= 2) return;
            LockSupport.parkNanos(Duration.ofMillis(10).toNanos());
        } while (System.nanoTime() < deadline);
        throw new AssertionError("Both independent request transactions must overlap while waiting for the product lock");
    }
}
