package com.fruitmachine.backend.user.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Repository
@RequiredArgsConstructor
public class UserStatusLockRepository {
    private final JdbcTemplate jdbc;

    public void acquire() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("User status lock requires an active transaction");
        }
        // FVM operation 2; serialize status decisions across application instances.
        // READ_COMMITTED reloads actor/target and counts ADMINs after obtaining this lock.
        jdbc.query("SELECT pg_advisory_xact_lock(?, ?)", (rs, row) -> Boolean.TRUE, 0x46564D, 2);
    }
}
