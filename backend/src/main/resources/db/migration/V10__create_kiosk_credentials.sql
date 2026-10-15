-- Machine-bound kiosk API credentials. The plaintext key is never stored: only a lookup
-- prefix and the SHA-256 hex digest of the 256-bit random secret.
CREATE TABLE kiosk_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    key_prefix VARCHAR(16) NOT NULL UNIQUE,
    secret_hash VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT ck_kiosk_credentials_prefix CHECK (key_prefix ~ '^[a-z0-9]{12}$'),
    CONSTRAINT ck_kiosk_credentials_status CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT ck_kiosk_credentials_hash CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_kiosk_credentials_revoked CHECK (
        (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= created_at)
        OR (status = 'ACTIVE' AND revoked_at IS NULL AND revoked_by IS NULL))
);

-- At most one usable credential per machine; revoked rows are retained as history.
CREATE UNIQUE INDEX uq_kiosk_credentials_active_machine
    ON kiosk_credentials (machine_id) WHERE status = 'ACTIVE';
CREATE INDEX ix_kiosk_credentials_machine_time ON kiosk_credentials (machine_id, created_at DESC);
