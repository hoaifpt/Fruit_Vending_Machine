-- Issue #72: manual refunds. No separate refund entity: a refunded payment carries its refund fields, the order (when the
-- refunded payment is the one that paid it) carries refunded_at, and one audit_logs row (PAYMENT_REFUNDED) keeps the trail.

ALTER TABLE payments
    ADD COLUMN refunded_at TIMESTAMPTZ,
    ADD COLUMN refunded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN refund_reason VARCHAR(24),
    ADD COLUMN refund_transfer_ref VARCHAR(64),
    ADD COLUMN refund_note VARCHAR(500),
    ADD CONSTRAINT ck_payments_refund CHECK (
        (status = 'REFUNDED') = (refunded_at IS NOT NULL AND refunded_by IS NOT NULL
                                 AND refund_reason IS NOT NULL AND refund_transfer_ref IS NOT NULL)),
    ADD CONSTRAINT ck_payments_refund_reason CHECK (refund_reason IS NULL OR refund_reason IN (
        'DISPENSE_FAILED', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'PRODUCT_QUALITY', 'OTHER')),
    ADD CONSTRAINT ck_payments_refund_ref CHECK (
        refund_transfer_ref IS NULL OR refund_transfer_ref ~ '^[A-Za-z0-9._/-]{4,64}$'),
    -- NULL-safe: an OTHER refund without a note (NULL or blank) is rejected.
    ADD CONSTRAINT ck_payments_refund_other CHECK (
        refund_reason IS DISTINCT FROM 'OTHER' OR (refund_note IS NOT NULL AND btrim(refund_note) <> '')),
    ADD CONSTRAINT ck_payments_refund_time CHECK (refunded_at IS NULL OR refunded_at >= paid_at);

-- One bank transfer cannot be recorded for two refunds.
CREATE UNIQUE INDEX uq_payments_refund_transfer_ref ON payments (refund_transfer_ref)
    WHERE refund_transfer_ref IS NOT NULL;
CREATE INDEX ix_payments_refunded_at ON payments (refunded_at) WHERE status = 'REFUNDED';

ALTER TABLE orders
    ADD COLUMN refunded_at TIMESTAMPTZ,
    ADD CONSTRAINT ck_orders_refunded CHECK ((status = 'REFUNDED') = (refunded_at IS NOT NULL));

-- Permissions (fixed UUIDs, like V13..V22); ADMIN only, STAFF has no access to payments.
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000034', 'PAYMENT_REFUND', 'Record a manual refund of a payment'),
    ('20000000-0000-0000-0000-000000000035', 'REFUND_READ', 'View refund candidates, refunds and refund totals');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000034'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000035');
