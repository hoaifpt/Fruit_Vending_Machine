-- Reservation deadline for PENDING_PAYMENT orders. Nullable so pre-existing rows stay valid;
-- the order service always sets it for new orders.
ALTER TABLE orders
    ADD COLUMN expires_at TIMESTAMPTZ,
    ADD CONSTRAINT ck_orders_expires_at CHECK (expires_at IS NULL OR expires_at > created_at);

CREATE INDEX ix_orders_pending_expiry ON orders (expires_at) WHERE status = 'PENDING_PAYMENT';
