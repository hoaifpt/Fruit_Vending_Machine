-- Issue #53. Presence and controller diagnostics reported by the machine over MQTT (heartbeat, status), all system-managed.
-- last_seen_at (V2) keeps its meaning: last valid message of any kind except the OFFLINE Last Will.
ALTER TABLE machines
    ADD COLUMN last_heartbeat_at TIMESTAMPTZ,
    ADD COLUMN last_offline_at TIMESTAMPTZ,
    ADD COLUMN firmware_version VARCHAR(32),
    ADD COLUMN uptime_seconds BIGINT,
    ADD COLUMN wifi_rssi SMALLINT,
    ADD COLUMN free_heap_bytes BIGINT,
    ADD CONSTRAINT ck_machines_uptime CHECK (uptime_seconds IS NULL OR uptime_seconds >= 0),
    ADD CONSTRAINT ck_machines_wifi_rssi CHECK (wifi_rssi IS NULL OR wifi_rssi BETWEEN -127 AND 0),
    ADD CONSTRAINT ck_machines_free_heap CHECK (free_heap_bytes IS NULL OR free_heap_bytes >= 0),
    ADD CONSTRAINT ck_machines_firmware_version CHECK (firmware_version IS NULL OR btrim(firmware_version) <> '');
