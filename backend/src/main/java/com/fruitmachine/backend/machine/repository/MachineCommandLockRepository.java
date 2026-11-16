package com.fruitmachine.backend.machine.repository;

import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * One command at a time per machine: every transaction that publishes a machine command or applies its result takes this
 * transaction-scoped advisory lock first (before Machine, Order, DispenseCommand and InventoryItem row locks). It also works
 * across backend instances. Maintenance commands must take the same lock.
 */
@Repository
@RequiredArgsConstructor
public class MachineCommandLockRepository {
    // FVM operation 3. Operations 1 and 2 use the key (0x46564D, operation); this one needs the machine in the key,
    // so the operation moves into the first half. A hash collision only makes two machines wait for each other.
    private static final int MACHINE_COMMAND = 0x46564D03;
    private final JdbcTemplate jdbc;

    /** Waits until no other transaction works on the commands of this machine. */
    public void acquire(UUID machineId) {
        requireTransaction();
        jdbc.query("SELECT pg_advisory_xact_lock(?, hashtext(?))", (rs, row) -> Boolean.TRUE, MACHINE_COMMAND, machineId.toString());
    }

    /** @return false when another transaction holds the lock; the caller skips its work and retries later. */
    public boolean tryAcquire(UUID machineId) {
        requireTransaction();
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(?, hashtext(?))", Boolean.class,
                MACHINE_COMMAND, machineId.toString()));
    }

    private static void requireTransaction() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Machine command lock requires an active transaction");
        }
    }
}
