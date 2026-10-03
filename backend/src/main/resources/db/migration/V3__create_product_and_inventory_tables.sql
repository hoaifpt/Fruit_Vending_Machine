CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price NUMERIC(12,2) NOT NULL,
    image_url VARCHAR(2048),
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_products_sku CHECK (btrim(sku) <> ''),
    CONSTRAINT ck_products_name CHECK (btrim(name) <> ''),
    -- Upper bounds also reject PostgreSQL numeric NaN.
    CONSTRAINT ck_products_price CHECK (price BETWEEN 0 AND 9999999999.99),
    CONSTRAINT ck_products_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_products_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE product_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_code VARCHAR(64) NOT NULL UNIQUE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    manufactured_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    quantity INTEGER NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_product_batches_code CHECK (btrim(batch_code) <> ''),
    CONSTRAINT ck_product_batches_quantity CHECK (quantity > 0),
    CONSTRAINT ck_product_batches_expiry CHECK (
        isfinite(manufactured_at) AND isfinite(expires_at) AND expires_at > manufactured_at)
);

CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES product_batches(id) ON DELETE RESTRICT,
    -- NULL before loading. Keep the last slot after sale/removal for traceability.
    slot_id UUID REFERENCES machine_slots(id) ON DELETE RESTRICT,
    status VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
    loaded_at TIMESTAMPTZ,
    reserved_at TIMESTAMPTZ,
    sold_at TIMESTAMPTZ,
    removed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, slot_id),
    CONSTRAINT ck_inventory_items_status CHECK (status IN (
        'AVAILABLE', 'RESERVED', 'SOLD', 'EXPIRED', 'REMOVED', 'DISPENSE_FAILED')),
    CONSTRAINT ck_inventory_items_loaded CHECK (slot_id IS NULL OR loaded_at IS NOT NULL),
    CONSTRAINT ck_inventory_items_reserved CHECK (
        status <> 'RESERVED' OR (slot_id IS NOT NULL AND reserved_at IS NOT NULL)),
    CONSTRAINT ck_inventory_items_sold CHECK (
        status <> 'SOLD' OR (slot_id IS NOT NULL AND sold_at IS NOT NULL)),
    CONSTRAINT ck_inventory_items_removed CHECK (status <> 'REMOVED' OR removed_at IS NOT NULL),
    CONSTRAINT ck_inventory_items_sale_time CHECK (
        sold_at IS NULL OR (loaded_at IS NOT NULL AND sold_at >= loaded_at)),
    CONSTRAINT ck_inventory_items_timestamps CHECK (updated_at >= created_at)
);
