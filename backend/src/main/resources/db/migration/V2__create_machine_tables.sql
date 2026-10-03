CREATE TABLE machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    location VARCHAR(500),
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    temperature_min NUMERIC(5,2) NOT NULL DEFAULT 2,
    temperature_max NUMERIC(5,2) NOT NULL DEFAULT 8,
    humidity_min NUMERIC(5,2) NOT NULL DEFAULT 0,
    humidity_max NUMERIC(5,2) NOT NULL DEFAULT 100,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_machines_code CHECK (btrim(code) <> ''),
    CONSTRAINT ck_machines_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_machines_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE')),
    CONSTRAINT ck_machines_temperature CHECK (
        temperature_min BETWEEN -100 AND 100 AND temperature_max BETWEEN -100 AND 100
        AND temperature_min <= temperature_max),
    CONSTRAINT ck_machines_humidity CHECK (
        humidity_min BETWEEN 0 AND 100 AND humidity_max BETWEEN 0 AND 100
        AND humidity_min <= humidity_max),
    CONSTRAINT ck_machines_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE machine_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    slot_code VARCHAR(32) NOT NULL,
    capacity INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (machine_id, slot_code),
    -- Required target for composite FKs enforcing slot/machine consistency.
    UNIQUE (id, machine_id),
    CONSTRAINT ck_machine_slots_code CHECK (btrim(slot_code) <> ''),
    CONSTRAINT ck_machine_slots_capacity CHECK (capacity > 0),
    CONSTRAINT ck_machine_slots_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'ERROR')),
    CONSTRAINT ck_machine_slots_timestamps CHECK (updated_at >= created_at)
);
