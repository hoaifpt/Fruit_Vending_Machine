CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_code VARCHAR(64) NOT NULL UNIQUE,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING_PAYMENT',
    subtotal NUMERIC(12,2) NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    UNIQUE (id, machine_id),
    CONSTRAINT ck_orders_code CHECK (btrim(order_code) <> ''),
    CONSTRAINT ck_orders_status CHECK (status IN (
        'PENDING_PAYMENT', 'PAID', 'DISPENSING', 'COMPLETED', 'CANCELLED',
        'PAYMENT_FAILED', 'DISPENSE_FAILED', 'REFUNDED')),
    CONSTRAINT ck_orders_money CHECK (
        subtotal BETWEEN 0 AND 9999999999.99 AND total_amount BETWEEN 0 AND 9999999999.99),
    CONSTRAINT ck_orders_paid_at CHECK (paid_at IS NULL OR paid_at >= created_at),
    CONSTRAINT ck_orders_completed_at CHECK (
        completed_at IS NULL OR (paid_at IS NOT NULL AND completed_at >= paid_at)),
    CONSTRAINT ck_orders_cancelled_at CHECK (cancelled_at IS NULL OR cancelled_at >= created_at)
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    -- Immutable purchase-price snapshot; never derived from the current product price.
    unit_price NUMERIC(12,2) NOT NULL,
    total_price NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT ck_order_items_money CHECK (
        unit_price BETWEEN 0 AND 9999999999.99 AND total_price BETWEEN 0 AND 9999999999.99),
    CONSTRAINT ck_order_items_total CHECK (total_price = quantity::NUMERIC * unit_price)
);

CREATE TABLE order_item_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMPTZ,
    CONSTRAINT ck_order_item_allocations_status CHECK (status IN ('RESERVED', 'DISPENSED', 'RELEASED')),
    CONSTRAINT ck_order_item_allocations_release CHECK (
        (status = 'RELEASED' AND released_at IS NOT NULL AND released_at >= created_at)
        OR (status <> 'RELEASED' AND released_at IS NULL)),
    CONSTRAINT ck_order_item_allocations_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    -- Extensible provider identifiers, not a closed CHECK list.
    provider VARCHAR(32) NOT NULL,
    transaction_id VARCHAR(255),
    payment_reference VARCHAR(255),
    amount NUMERIC(12,2) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    qr_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    CONSTRAINT ck_payments_provider CHECK (provider = upper(btrim(provider)) AND provider <> ''),
    CONSTRAINT ck_payments_transaction CHECK (transaction_id IS NULL OR btrim(transaction_id) <> ''),
    CONSTRAINT ck_payments_reference CHECK (payment_reference IS NULL OR btrim(payment_reference) <> ''),
    CONSTRAINT ck_payments_amount CHECK (amount BETWEEN 0 AND 9999999999.99),
    CONSTRAINT ck_payments_status CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED')),
    CONSTRAINT ck_payments_success CHECK (
        status NOT IN ('SUCCESS', 'REFUNDED') OR (paid_at IS NOT NULL AND transaction_id IS NOT NULL)),
    CONSTRAINT ck_payments_paid_time CHECK (paid_at IS NULL OR paid_at >= created_at),
    CONSTRAINT ck_payments_expiry CHECK (expired_at IS NULL OR expired_at > created_at)
);

CREATE TABLE payment_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(32) NOT NULL,
    event_type VARCHAR(100),
    -- Deliberately not an FK: log unknown/invalid order references too.
    order_code VARCHAR(64),
    raw_payload JSONB,
    -- Retain the exact body for signature checks, including invalid JSON.
    raw_body TEXT NOT NULL,
    signature TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_payment_webhook_logs_provider CHECK (
        provider = upper(btrim(provider)) AND provider <> '')
);
