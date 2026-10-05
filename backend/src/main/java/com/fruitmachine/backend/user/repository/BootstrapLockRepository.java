package com.fruitmachine.backend.user.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Repository
public class BootstrapLockRepository {
    private final JdbcTemplate jdbc;

    public BootstrapLockRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void acquire() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Bootstrap lock requires an active transaction");
        }
        // Reserved bootstrap namespace (ASCII FVM), operation 1. Released on commit/rollback.
        // JpaTransactionManager shares its datasource connection with JdbcTemplate.
        jdbc.query("SELECT pg_advisory_xact_lock(?, ?)", (rs, row) -> Boolean.TRUE, 0x46564D, 1);
    }
}
