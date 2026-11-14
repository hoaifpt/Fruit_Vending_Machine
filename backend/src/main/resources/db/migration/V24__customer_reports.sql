-- Issue #74: customer incident reports from a public form (WF-02).

-- Report token of a machine: printed in the kiosk QR, allows submitting reports for that machine only (not the kiosk key, not the id).
-- New and existing rows get a 32-character random token (122 bits from gen_random_uuid; pgcrypto is not required); rotation in the
-- application writes a 22-character base64url token. Both match the CHECK.
ALTER TABLE machines ADD COLUMN report_token VARCHAR(32) DEFAULT replace(gen_random_uuid()::text, '-', '');
UPDATE machines SET report_token = replace(gen_random_uuid()::text, '-', '') WHERE report_token IS NULL;
ALTER TABLE machines
    ALTER COLUMN report_token SET NOT NULL,
    ADD CONSTRAINT uq_machines_report_token UNIQUE (report_token),
    ADD CONSTRAINT ck_machines_report_token CHECK (report_token ~ '^[A-Za-z0-9_-]{22,32}$');

CREATE TABLE customer_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
    type VARCHAR(24) NOT NULL,
    description VARCHAR(1000),
    order_code_input VARCHAR(64),
    order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES product_batches(id) ON DELETE RESTRICT,
    verdict VARCHAR(32) NOT NULL,
    contact_name VARCHAR(100),
    contact_phone VARCHAR(20),
    contact_email VARCHAR(254),
    status VARCHAR(16) NOT NULL DEFAULT 'NEW',
    work_order_id UUID REFERENCES work_orders(id) ON DELETE RESTRICT,
    resolution VARCHAR(24),
    resolution_note VARCHAR(1000),
    resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    resolved_at TIMESTAMPTZ,
    source_ip_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_customer_reports_type CHECK (type IN ('PAID_NOT_RECEIVED', 'PRODUCT_QUALITY', 'MACHINE_FAULT', 'OTHER')),
    CONSTRAINT ck_customer_reports_status CHECK (status IN ('NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED')),
    CONSTRAINT ck_customer_reports_verdict CHECK (verdict IN (
        'NOT_APPLICABLE', 'ORDER_NOT_FOUND', 'REFUND_ELIGIBLE', 'DISPENSE_PENDING',
        'DELIVERED_PER_MACHINE', 'ALREADY_REFUNDED', 'NOT_PAID')),
    CONSTRAINT ck_customer_reports_resolution CHECK (
        (status IN ('RESOLVED', 'REJECTED')) = (resolution IS NOT NULL AND resolved_at IS NOT NULL)),
    CONSTRAINT ck_customer_reports_resolution_value CHECK (resolution IS NULL OR resolution IN (
        'REFUNDED', 'FIXED', 'NO_ACTION_NEEDED', 'SPAM', 'DUPLICATE')),
    CONSTRAINT ck_customer_reports_order_required CHECK (type <> 'PAID_NOT_RECEIVED' OR order_code_input IS NOT NULL),
    CONSTRAINT ck_customer_reports_description CHECK (
        type = 'PAID_NOT_RECEIVED' OR (description IS NOT NULL AND btrim(description) <> ''))
);
CREATE INDEX ix_customer_reports_status_time ON customer_reports (status, created_at DESC);
CREATE INDEX ix_customer_reports_machine_time ON customer_reports (machine_id, created_at DESC);
CREATE INDEX ix_customer_reports_order ON customer_reports (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX ix_customer_reports_work_order ON customer_reports (work_order_id);

CREATE TABLE customer_report_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES customer_reports(id) ON DELETE CASCADE,
    content_type VARCHAR(16) NOT NULL,
    size_bytes INTEGER NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_customer_report_photos_type CHECK (content_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT ck_customer_report_photos_size CHECK (size_bytes BETWEEN 1 AND 2097152)
);
CREATE INDEX ix_customer_report_photos_report ON customer_report_photos (report_id);

-- Permissions (fixed UUIDs, like V13..V23).
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000036', 'CUSTOMER_REPORT_READ', 'View customer incident reports (STAFF: only those of their work orders)'),
    ('20000000-0000-0000-0000-000000000037', 'CUSTOMER_REPORT_MANAGE', 'Review, resolve and reject customer incident reports'),
    ('20000000-0000-0000-0000-000000000038', 'MACHINE_REPORT_LINK_MANAGE', 'Rotate the public report token (QR) of a machine');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000036'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000037'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000038'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000036');
