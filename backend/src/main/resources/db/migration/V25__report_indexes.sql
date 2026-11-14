-- Issue #76: dashboard and sales reports. Indexes only (no new tables) plus three permissions.
-- payments(refunded_at) exists since V23 (ix_payments_refunded_at); order_items(order_id) since V7 (ix_order_items_order).

-- Sales are attributed to completed_at (business-zone day / hour buckets).
CREATE INDEX ix_orders_completed_at ON orders (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX ix_orders_machine_completed ON orders (machine_id, completed_at) WHERE completed_at IS NOT NULL;
-- Cash view: money that arrived (SUCCESS or later REFUNDED) by paid_at.
CREATE INDEX ix_payments_paid_at ON payments (paid_at) WHERE status IN ('SUCCESS', 'REFUNDED');

-- Permissions (fixed UUIDs, like V13..V24).
INSERT INTO permissions (id, code, description) VALUES
    ('20000000-0000-0000-0000-000000000039', 'DASHBOARD_READ', 'View the operations dashboard (machines, alerts, work orders, stock)'),
    ('20000000-0000-0000-0000-000000000040', 'REPORT_SALES_READ', 'View sales reports and the revenue figures of the dashboard'),
    ('20000000-0000-0000-0000-000000000041', 'REPORT_EXPORT', 'Export sales reports as CSV or PDF');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000039'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000040'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000041'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000039');
