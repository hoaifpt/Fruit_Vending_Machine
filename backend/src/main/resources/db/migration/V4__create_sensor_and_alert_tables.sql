CREATE TABLE sensor_readings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    temperature NUMERIC(5,2),
    humidity NUMERIC(5,2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_sensor_readings_value CHECK (temperature IS NOT NULL OR humidity IS NOT NULL),
    CONSTRAINT ck_sensor_readings_temperature CHECK (temperature BETWEEN -100 AND 100),
    CONSTRAINT ck_sensor_readings_humidity CHECK (humidity BETWEEN 0 AND 100),
    CONSTRAINT ck_sensor_readings_time CHECK (isfinite(recorded_at))
);

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    type VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_alerts_type CHECK (type IN (
        'HIGH_TEMPERATURE', 'LOW_TEMPERATURE', 'HIGH_HUMIDITY', 'MACHINE_OFFLINE',
        'PRODUCT_EXPIRED', 'PRODUCT_EXPIRING', 'DISPENSE_FAILED', 'LOW_STOCK')),
    CONSTRAINT ck_alerts_severity CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    CONSTRAINT ck_alerts_status CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    CONSTRAINT ck_alerts_title CHECK (btrim(title) <> ''),
    CONSTRAINT ck_alerts_resolution CHECK (
        (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_at >= triggered_at)
        OR (status <> 'RESOLVED' AND resolved_at IS NULL AND resolved_by IS NULL)),
    CONSTRAINT ck_alerts_timestamps CHECK (updated_at >= created_at)
);
