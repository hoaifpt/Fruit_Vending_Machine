-- Issue #48: permission-based authorization. A role is a set of permissions; endpoints check permissions, never ADMIN/STAFF.
-- Codes never start with ROLE_, so they cannot collide with role authorities. Later issues add their own permissions in new migrations.
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_permissions_code CHECK (code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX ix_role_permissions_permission ON role_permissions (permission_id);

-- Required reference data in every environment (fixed UUIDs, like V8).
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000001', 'USER_READ', 'List and view management user accounts'),
    ('20000000-0000-0000-0000-000000000002', 'USER_WRITE', 'Create users, update profiles and change account status'),
    ('20000000-0000-0000-0000-000000000003', 'PERMISSION_MANAGE', 'View roles and permissions and change a role''s permissions'),
    ('20000000-0000-0000-0000-000000000004', 'PRODUCT_READ', 'List and view products'),
    ('20000000-0000-0000-0000-000000000005', 'PRODUCT_WRITE', 'Create and update products and change product status'),
    ('20000000-0000-0000-0000-000000000006', 'MACHINE_READ', 'List and view machines and slots'),
    ('20000000-0000-0000-0000-000000000007', 'MACHINE_WRITE', 'Create and update machines and slots and change their status'),
    ('20000000-0000-0000-0000-000000000008', 'KIOSK_CREDENTIAL_MANAGE', 'Issue, list and revoke kiosk credentials'),
    ('20000000-0000-0000-0000-000000000009', 'BATCH_READ', 'List and view product batches'),
    ('20000000-0000-0000-0000-000000000010', 'BATCH_CREATE', 'Create product batches'),
    ('20000000-0000-0000-0000-000000000011', 'INVENTORY_READ', 'View inventory items, machine and slot inventory, summaries and history'),
    ('20000000-0000-0000-0000-000000000012', 'INVENTORY_WRITE', 'Load bowls into slots and remove bowls'),
    ('20000000-0000-0000-0000-000000000013', 'ORDER_READ', 'List and view orders'),
    ('20000000-0000-0000-0000-000000000014', 'PAYMENT_READ', 'List and view payments'),
    ('20000000-0000-0000-0000-000000000015', 'PAYMENT_WEBHOOK_LOG_READ', 'List and view payment webhook logs');

-- Reproduces the role-based access that existed before this migration exactly (ADMIN = everything, STAFF = operations).
INSERT INTO role_permissions (role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000001', id FROM permissions;

INSERT INTO role_permissions (role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000002', id FROM permissions
WHERE code IN ('PRODUCT_READ', 'MACHINE_READ', 'BATCH_READ', 'BATCH_CREATE', 'INVENTORY_READ', 'INVENTORY_WRITE', 'ORDER_READ');
