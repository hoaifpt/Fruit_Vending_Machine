package com.fruitmachine.backend.support;

import org.testcontainers.containers.PostgreSQLContainer;

/** A fresh, disposable database; lifecycle remains owned by each test class. */
public final class TestPostgres {
    private TestPostgres() {}

    public static PostgreSQLContainer<?> create() {
        return new PostgreSQLContainer<>("postgres:18").withReuse(false);
    }
}
