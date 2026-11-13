# Database Design — current Flyway schema

## 1. Authority and status

PostgreSQL 18; Flyway V1–V12 under `src/main/resources/db/migration/` (relative to
the backend module). These migrations define the current schema, not a proposed model.
There are **20 business tables** (V10 adds `kiosk_credentials`) plus `flyway_schema_history` (Flyway infrastructure,
not a JPA business entity). Detailed constraints and ERD also appear in
[database-migration.md](../../docs/database-migration.md); mappings are described in
[jpa-entities.md](../../docs/jpa-entities.md). SQL remains authoritative.

Hibernate uses `ddl-auto=validate`, `generate-ddl=false`; SQL initialization is disabled.
Validation is not a full audit of CHECK/index/trigger/nullability definitions.
Never edit an applied migration. A genuine schema change needs a new V13+ migration.
The package/convention alignment does not require any schema change.

## 2. Types and conventions

- Business IDs: UUID with database `gen_random_uuid()` defaults; JPA uses GenerationType.UUID.
- `sensor_readings.id`: BIGINT GENERATED ALWAYS AS IDENTITY; JPA Long/IDENTITY.
- `user_roles`: composite PK (user_id, role_id), mapped by UserRoleId/@MapsId.
- TIMESTAMPTZ: Java Instant for absolute timestamps, UTC API/JDBC convention.
  Offset/region conversion belongs at integration/display boundaries; PostgreSQL does
  not retain the original zone. Use injected Clock for deterministic business-time tests.
- Money: NUMERIC(12,2)/BigDecimal; sensor readings and thresholds: NUMERIC(5,2)/BigDecimal.
- Closed status/type vocabularies: VARCHAR + CHECK, Java EnumType.STRING, not PostgreSQL ENUM.
- Provider, role name and machine event type are extensible strings, not closed enums.
- JSONB: JsonNode. TEXT: String, not PostgreSQL large-object @Lob.
- Never add @Version, soft-delete columns, generic audit actor columns, or relationships
  not present in Flyway merely to simplify ORM code.

## 3. All current tables and columns

The lists below are actual columns. Nullable links/timestamps are clarified afterwards.

| Table | Columns |
| --- | --- |
| users | id, email, password_hash, full_name, phone, status, created_at, updated_at |
| roles | id, name, description, created_at |
| user_roles | user_id, role_id |
| machines | id, code, name, location, status, temperature_min, temperature_max, humidity_min, humidity_max, last_seen_at, last_heartbeat_at, last_offline_at, firmware_version, uptime_seconds, wifi_rssi, free_heap_bytes, created_at, updated_at |
| machine_slots | id, machine_id, slot_code, capacity, status, created_at, updated_at |
| products | id, sku, name, description, price, image_url, status, created_at, updated_at |
| product_batches | id, batch_code, product_id, manufactured_at, expires_at, quantity, created_by, created_at |
| inventory_items | id, batch_id, slot_id, status, loaded_at, reserved_at, sold_at, removed_at, created_at, updated_at |
| sensor_readings | id, machine_id, temperature, humidity, recorded_at |
| alerts | id, machine_id, slot_id, type, severity, error_code, dedupe_key, title, message, status, triggered_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by, resolution_note, created_at, updated_at |
| notifications | id, user_id, alert_id, title, message, severity, read_at, created_at |
| orders | id, order_code, machine_id, status, subtotal, discount_amount (V18), total_amount, created_at, paid_at, completed_at, cancelled_at, expires_at (V11, nullable reservation deadline) |
| order_items | id, order_id, product_id, quantity, original_unit_price, unit_price, total_price, discount_percent, discount_reason, created_at |
| pricing_settings | id, near_expiry_enabled, near_expiry_percent, version, updated_at, updated_by, singleton |
| maintenance_plans | id, machine_id, title, instructions, interval_days, lead_days, due_time, priority, default_assignee_id, next_due_date, active, last_completed_at, created_by, version, created_at, updated_at |
| restock_lines | id, work_order_id, machine_id, slot_id, product_id, planned_quantity, loaded_quantity, variance_reason, created_at, updated_at |
| work_orders | id, code, type, source, machine_id, title, description, priority, status, assignee_id, due_at, created_by, started_at, completed_at, completed_by, result_note, cancelled_at, cancelled_by, cancel_reason, overdue_notified_at, version, created_at, updated_at |
| work_order_alerts | work_order_id, alert_id, created_at |
| work_order_events | id, work_order_id, type, status_before, status_after, actor_id, note, details, created_at |
| maintenance_commands | id, command_code, machine_id, slot_id, operation, status, reason, note, target_inventory_item_id, requested_by, idempotency_key, attempt_count, sent_at, accepted_at, finished_at, failure_reason, removed_count, reconciled_by, reconciled_at, reconciliation_outcome, created_at, updated_at |
| order_item_allocations | id, order_item_id, inventory_item_id, status, created_at, updated_at, released_at |
| payments | id, order_id, provider, transaction_id, payment_reference, amount, status, qr_code, created_at, paid_at, expired_at |
| payment_webhook_logs | id, provider, event_type, order_code, raw_payload, raw_body, signature, is_verified, received_at |
| dispense_commands | id, command_code, order_id, machine_id, slot_id, inventory_item_id, status, sent_at, acknowledged_at, completed_at, failure_reason, created_at, updated_at |
| inventory_transactions | id, inventory_item_id, machine_id, slot_id, type, reference_id, performed_by, created_at, reason, status_before, status_after |
| machine_events | id, machine_id, event_type, payload, source, message_id, created_at |
| kiosk_credentials | id, machine_id, key_prefix, secret_hash, status, created_by, created_at, revoked_by, revoked_at |
| audit_logs | id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, created_at |

## 4. Relationships and integrity

- User -> UserRole <- Role. Deleting a user cascades only its membership rows at DB
  level; role deletion is RESTRICT. Prefer deactivation. JPA does not cascade REMOVE/ALL.
  Seed V8 contains ADMIN/STAFF reference roles only, no accounts or passwords.
- Machine -> MachineSlot, SensorReading, Alert, MachineEvent and Order.
  Slots have UNIQUE(machine_id, slot_code), capacity > 0 and UNIQUE(id, machine_id). Since V14 a slot is a physical
  column: slot_code IN ('A','B') (ck_machine_slots_column), so a machine has at most two slots.
- Product -> ProductBatch -> InventoryItem. Batch quantity > 0 and finite
  expires_at > manufactured_at. created_by -> users is nullable.
- InventoryItem.slot_id -> MachineSlot is nullable before loading. Keep the last slot
  after sale/removal for traceability; there is **no inventory_items.machine_id**.
- Order -> OrderItem -> OrderItemAllocation -> InventoryItem.
  OrderItem also references Product. One order can have multiple payment attempts.
  Allocation is not a direct inventory_item_id column on order_items.
- DispenseCommand references exactly one order/machine/slot/item. Composite FKs enforce:
  (order_id, machine_id) -> orders(id, machine_id);
  (slot_id, machine_id) -> machine_slots(id, machine_id);
  (inventory_item_id, slot_id) -> inventory_items(id, slot_id).
  command_code is unique. JPA writes the scalar UUIDs and provides read-only navigation.
- InventoryTransaction -> InventoryItem; performed_by -> users nullable.
  Snapshot (slot_id, machine_id) -> machine_slots(id, machine_id), MATCH FULL:
  both NULL for off-machine inventory, otherwise both present. LOAD/RESERVE/SALE
  require a location. reference_id is a polymorphic UUID without a business FK.
- Alert.resolved_by and AuditLog.user_id are nullable user FKs with RESTRICT deletion.
  AuditLog.entity_id is a polymorphic historical UUID, not an entity FK.
- **PaymentWebhookLog has no FK to orders or payments.** order_code is an untrusted
  scalar reference so unmatched/invalid webhooks can still be recorded. raw_body is
  required exact TEXT (including invalid JSON); raw_payload is nullable JSONB.
  There are no payment_id, processing_status, error_message or processed_at columns.
  A log row alone is not an idempotency guard or evidence of verified payment.
- Historical/business FKs use RESTRICT except the membership exception above.

## 5. Exact closed vocabularies

| Field | Allowed values |
| --- | --- |
| users.status | ACTIVE, INACTIVE, LOCKED |
| machines.status | ACTIVE, INACTIVE, MAINTENANCE |
| machine_slots.status | ACTIVE, INACTIVE, ERROR |
| products.status | ACTIVE, INACTIVE |
| inventory_items.status | AVAILABLE, RESERVED, SOLD, EXPIRED, REMOVED, DISPENSE_FAILED |
| inventory_transactions.type | LOAD, RESERVE, SALE, EXPIRE, REMOVE, RETURN, ADJUSTMENT |
| alerts.type | HIGH_TEMPERATURE, LOW_TEMPERATURE, HIGH_HUMIDITY, MACHINE_OFFLINE, PRODUCT_EXPIRED, PRODUCT_EXPIRING, DISPENSE_FAILED, LOW_STOCK, HARDWARE_FAULT |
| alerts.severity | INFO, WARNING, CRITICAL |
| alerts.status | OPEN, ACKNOWLEDGED, RESOLVED |
| orders.status | PENDING_PAYMENT, PAID, DISPENSING, COMPLETED, CANCELLED, PAYMENT_FAILED, DISPENSE_FAILED, REFUNDED |
| order_item_allocations.status | RESERVED, DISPENSED, RELEASED |
| payments.status | PENDING, SUCCESS, FAILED, EXPIRED, REFUNDED |
| dispense_commands.status | PENDING, SENT, ACKNOWLEDGED, SUCCESS, FAILED, TIMEOUT |

"Expiring soon" is derived from batch expiry for display/alerts, not an additional
InventoryStatus. Open vocabularies must not be constrained to sample provider/event names.

## 6. Inventory, prices and service responsibilities

Each InventoryItem is one physical bowl; never replace this model with slot.quantity.
AVAILABLE in stockroom or a batch past expiry is not sellable at a machine.
A saleable item requires a loaded slot, AVAILABLE status, unexpired batch, and ACTIVE
product/slot/machine. Services must recheck these conditions when reserving and fulfilling.

Illustrative read-only candidate query (not the final locking/allocation implementation):

```sql
SELECT i.id
FROM inventory_items i
JOIN product_batches b ON b.id = i.batch_id
JOIN products p ON p.id = b.product_id
JOIN machine_slots s ON s.id = i.slot_id
JOIN machines m ON m.id = s.machine_id
WHERE s.id = :slot_id
  AND i.status = 'AVAILABLE'
  AND b.expires_at > :now
  AND p.status = 'ACTIVE'
  AND s.status = 'ACTIVE'
  AND m.status = 'ACTIVE';
```

Slot capacity counts physical occupants in AVAILABLE/RESERVED/EXPIRED/DISPENSE_FAILED;
SOLD/REMOVED retain historical slot links but do not occupy capacity. Reservation/load
must lock/recheck to handle concurrency. Batch.quantity is production quantity, not a
live slot stock counter. Expiration jobs do not replace real-time expiry checks.

OrderItem.unit_price is a purchase snapshot, not a dynamic products.price lookup.
DB enforces positive quantity, bounded nonnegative money and total_price = quantity * unit_price.
Calculating order totals, matching payment amounts, valid state transitions and allocation
quantity consistency belong in services; existing CHECK constraints are not a workflow engine.

## 7. Approved payment/dispense workflow (future implementation)

Kiosk creates order -> backend reserves bowls and creates QR -> provider webhook ->
backend verifies payment and sets PAID -> backend persists/authorizes DispenseCommand ->
kiosk receives PAID and command -> kiosk sends DISPENSE <commandId> <slot=A2> over
Serial/USB -> ESP32 reports DISPENSE_SUCCESS <commandId> -> kiosk reports result ->
backend validates and records command SUCCESS, allocation DISPENSED and item SOLD.

Backend completes the order only after all required bowls succeed; use DISPENSING while
fulfillment is in progress. Persist sold_at/completed_at and required inventory history
with legal transitions. Authenticate kiosk and validate command ownership, machine,
allocation and payment; client reports cannot mark an order PAID.

Webhook and result handling must be idempotent. Do not blindly resend after timeout or
an ambiguous motor result: reconcile first to prevent double dispensing.
This is the approved design; payment, dispense endpoints, Serial protocol implementation,
authentication and business services are not implemented by this documentation update.

## 8. Indexes and history

V7 contains actual workload indexes; inspect it before adding another index. Key guards:

- UNIQUE partial uq_order_item_allocations_live_inventory on inventory_item_id for
  RESERVED/DISPENSED: a bowl cannot have two live allocations.
- UNIQUE partial uq_dispense_commands_live_inventory on inventory_item_id for
  PENDING/SENT/ACKNOWLEDGED/SUCCESS: an active/successful command blocks another one.
  FAILED/TIMEOUT require physical reconciliation before any replacement command.
- UNIQUE partial uq_payments_provider_transaction on (provider, transaction_id)
  when transaction_id is not NULL; provider transaction namespaces are separate.
- Sensor history: (machine_id, recorded_at DESC) plus BRIN(recorded_at).
- Webhook logs keep duplicate/invalid attempts, indexed by order_code/received_at and
  provider/received_at; no uniqueness on payload/signature/order_code.

The V6 append-only trigger rejects UPDATE/DELETE/TRUNCATE of inventory_transactions;
corrections append ADJUSTMENT records. JPA @Immutable is an additional dirty-update
guard, not a replacement for the DB trigger. Other histories are preserved by application
policy/FKs, not assumed to have this trigger.

## 9. Timestamp ownership and verification

Shared mapped superclasses are in common.entity; feature entities/enums remain feature-owned.
BaseEntity provides created_at/updated_at auditing only for tables that actually have both.
CreatedEntity reads DB-generated created_at for create-only tables; InventoryTransaction
uses its immutable-specific creation mapping. Sensor event time and webhook received_at
have dedicated mappings. Do not add columns solely to inherit a superclass.

SQL/native/bulk updates bypass JPA auditing listeners and must explicitly maintain relevant
timestamps. State checks cover required timestamps, but services enforce transition semantics.

Verify changes with Java 21, Maven and Docker: `mvn clean verify` from the backend module.
Integration tests use PostgreSQL 18 Testcontainers, apply all twelve migrations, run Flyway
validation and Hibernate validation, and check all 20 entity mappings. Never use update/create
or edit historical migration files to make entity validation pass.

## 10. Issue #22 schema audit and V9

V3 and V6 were inspected before implementation: inventory_items has nullable slot_id,
no machine_id; inventory_transactions originally has eight columns and one row per item.
There was no quantity, batch_id, reason or status snapshot column. V7 indexes and the
V6 MATCH FULL location FK/append-only trigger are reused. V9 adds nullable reason
VARCHAR(500), status_before/status_after VARCHAR(24), nonblank reason and inventory
vocabulary checks. Legacy rows remain NULL; no fabricated backfill or trigger bypass.
LOAD creates N rows sharing a server reference_id; REMOVE records reason/actor/statuses.
Batch is derived through inventory_item_id. V1–V8 remain unchanged.

Loading locks Product -> Batch -> Machine -> Slot; all registrations, including removed
items, count against batch quantity. Removal locks Slot -> Item, keeps the last slot,
and permits AVAILABLE/EXPIRED only. Summary counts/eligibility/capacity share one SQL
statement snapshot; expiry uses current server time without a scheduler. API loading
always assigns a slot; legacy off-machine rows remain nullable/readable. See
[inventory-management.md](../../docs/inventory-management.md).

## 11. Issue #27 — kiosk credentials, order expiry and reservation (V10, V11)

V5/V7 were inspected first: orders, order_items (unit_price snapshot, ck_order_items_total),
order_item_allocations (live partial unique index on RESERVED/DISPENSED) and the V6/V9
inventory_transactions rules are reused unchanged; there was no reservation deadline column.

- **V10 kiosk_credentials**: machine-bound API credential, not a user. Only `key_prefix`
  (12 chars [a-z0-9], UNIQUE) and `secret_hash` (lowercase hex SHA-256 of a 256-bit random secret,
  CHECK `^[0-9a-f]{64}$`) are stored; the plaintext `fvk_<prefix>_<secret>` is returned once. Status
  ACTIVE/REVOKED with a revocation consistency CHECK. Partial UNIQUE `uq_kiosk_credentials_active_machine`
  allows one ACTIVE credential per machine; revoked rows are kept as history. FKs are RESTRICT.
- **V11 orders.expires_at**: nullable TIMESTAMPTZ, `ck_orders_expires_at` (expires_at > created_at) and
  partial index `ix_orders_pending_expiry` on PENDING_PAYMENT. The service always sets it.
- **Lock order for order workflows** (superseded for creation by #35, see section 15): create = Product (FOR SHARE)
  -> Machine (FOR SHARE) -> candidate Slots (FOR UPDATE, id order) -> head InventoryItem (FOR UPDATE). Cancel/expiry = Order (FOR UPDATE) ->
  InventoryItems sorted by id. Inventory loading (Product/Batch/Machine/Slot) and removal (Slot/Item)
  keep their order; shared locks serialize with their exclusive product/machine writes without
  blocking other orders.
  Later payment issues extend the order as Order -> Payment -> InventoryItem.
- **History usage**: reservation appends one `RESERVE` row per bowl (reference_id = order id,
  performed_by NULL because a kiosk is not a user, snapshot machine/slot, AVAILABLE -> RESERVED).
  Reservation release (kiosk cancel or expiry sweep) appends one `RETURN` row per bowl
  (RESERVED -> AVAILABLE, reason ORDER_CANCELLED or RESERVATION_EXPIRED). Rows are never updated.
- A bowl is reservable only if its batch expires after the order deadline (`expires_at`), so it
  cannot expire while unpaid. A released bowl of an expired batch becomes AVAILABLE but stays
  unsellable (expiry is checked, not scheduled).

## 12. Issue #29 — payment attempts (V12)

V5 payments, V7 indexes, V10 and V11 were inspected first. `payments` has no `updated_at` (not added) and
`payment_reference` had no uniqueness guarantee. **V12** adds `uq_payments_provider_reference`: UNIQUE
(provider, payment_reference) WHERE payment_reference IS NOT NULL, so a webhook can resolve an attempt by our reference;
namespaces are per provider. Creation fails if existing rows violate it; nothing is rewritten. No entity mapping change.

- **Attempt rules**: amount = order.total_amount; expired_at = min(order.expires_at, now + attempt-ttl) (> created_at by CHECK);
  PENDING with qr_code is the only reusable state, PENDING without qr_code means creation in flight; at most
  `app.payment.max-attempts-per-order` rows per order. Allowed transitions here: PENDING -> FAILED/EXPIRED only
  (centralized in PaymentTransitions). SUCCESS/REFUNDED, transaction_id and paid_at stay untouched until the webhook issue.
- **No transaction during the provider call**: step 1 (lock Order, lock its payments, insert PENDING) and step 3 (lock Order,
  lock the payment, record QR or FAILED) are separate transactions; the gateway call in between has none.
- **Lock order for order-state workflows (extends section 11)**: Order -> Payment -> InventoryItem. Order cancel and the
  expiry sweep lock the order, expire its PENDING payments, then release the bowls. Attempt creation locks Order then Payment.
  The payments of one order are always locked in id order.
- A cancelled or expired order never keeps a PENDING payment; there is no CANCELLED payment status (EXPIRED = the QR is no longer valid).

## 13. Issue #31 — payOS provider (no schema change)

No migration. payOS reuses `payments.provider = PAYOS`, `payments.payment_reference` = payOS orderCode (15 digits, decimal text),
`payments.qr_code` = VietQR payload and `payments.expired_at` (also sent to payOS as expiredAt). `uq_payments_provider_reference` (V12) is the
final uniqueness guard; step 1 of attempt creation pre-checks the reference and regenerates it up to 3 times. `checkoutUrl` and `paymentLinkId`
are not stored. `transaction_id` stays NULL until the webhook issue fills it from the webhook reference. The lock order Order -> Payment -> InventoryItem is unchanged;
provider-side cancellation of an expired attempt happens after the committing transaction, never while locks are held.

## 14. Issue #33 — payment webhook handling (no schema change)

V5, V6, V7, V11 and V12 and the AuditLog mapping were inspected; nothing is added. Column usage:

- `payment_webhook_logs`: one row per webhook attempt that reaches verification, written in its own transaction BEFORE business processing.
  `raw_body` is the exact received text (NUL replaced by U+FFFD because PostgreSQL text cannot store it), `raw_payload` the parsed JSON or NULL,
  `signature` as received, `is_verified` the verification result, `event_type` PAYMENT_SUCCESS / PAYMENT_FAILED / UNKNOWN, and `order_code` the **untrusted PROVIDER
  reference hint** (for payOS the orderCode, at most 64 characters, otherwise NULL). It is not `orders.order_code`. There is no FK, no processing status and a row is neither an idempotency guard nor evidence of payment.
- `payments`: SUCCESS sets `transaction_id` and `paid_at` (server clock, never below `created_at`); allowed transitions are now PENDING to FAILED/EXPIRED/SUCCESS and FAILED/EXPIRED to SUCCESS. `uq_payments_provider_transaction` is the final guard against a transaction id reused by another payment.
- `orders`: PENDING_PAYMENT to PAID with `paid_at`; allocations and inventory stay RESERVED (no SOLD, no DISPENSED, no dispense command).
- `audit_logs`: one row per anomaly, `user_id` NULL, `entity_type` Payment, `entity_id` the payment id, actions PAYMENT_LATE, PAYMENT_DUPLICATE, PAYMENT_AMOUNT_MISMATCH, PAYMENT_TRANSACTION_CONFLICT; `old_value` and `new_value` carry statuses, transactionId, amountReceived and amountExpected.
- **Lock order** is unchanged: Order, then Payment, then InventoryItem. The webhook locks the Order and then the Payment (found by an ids-only lookup so no stale copy is loaded first). Provider calls never happen inside the transaction; links of attempts expired by PAID are cancelled after commit.
- Known limitation: PAID orders keep their bowls RESERVED until the dispense flow exists; there is no PAID timeout in this milestone.

## 15. Issue #35 — one bowl per order, slot head (no schema change)

V1-V12 untouched. `order_items` and `order_item_allocations` still allow many rows (historical #27 orders); the one-bowl rule lives in
the request DTO and OrderService, deliberately without a CHECK quantity = 1.

- **Head of a slot**: among `inventory_items` of the slot with status IN (AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED), the row with the
  earliest `loaded_at`, tie-break `id`. SOLD/REMOVED rows keep `slot_id` for history but are not in the column. Assumption to confirm with the
  hardware team: columns are refilled from the top, so earlier loaded_at = lower position; rows of one load share loaded_at, batch and expiry.
- **Sellable slot**: head AVAILABLE, head batch `expires_at` > order `expires_at`, product ACTIVE, slot ACTIVE, machine ACTIVE, same machine,
  head product = requested product. Only the head is reservable, so at most one RESERVED item per slot.
- **FEFO between heads only**: head batch expires_at, then head loaded_at, slot_code, slot id. Never inside a column.
- **Lock order**: create = Product (FOR SHARE) -> Machine (FOR SHARE) -> Slots holding the product (FOR UPDATE, sorted by id) -> head
  InventoryItem (FOR UPDATE, rechecked). Loading = Product -> Batch -> Machine -> Slot; removal = Slot -> Item; release = Order -> Payment ->
  InventoryItem. Loads of the same product or into the same machine wait on the shared Product/Machine locks; removal waits on the slot lock.
- Queries: `findSlotIdsHoldingProduct` (unlocked discovery), `findSellableHeadId` and `findCatalog` (DISTINCT ON over the present items).

## 16. Issue #48 — V13 permissions

- `permissions`: id UUID PK, `code` VARCHAR(64) UNIQUE with CHECK `^[A-Z][A-Z0-9_]{2,63}$` (never `ROLE_...`), `description` NOT NULL,
  `created_at`. Seeded with fixed UUIDs `20000000-0000-0000-0000-0000000000NN` (01 USER_READ ... 15 PAYMENT_WEBHOOK_LOG_READ).
- `role_permissions`: PK (role_id, permission_id); `role_id` -> roles ON DELETE CASCADE, `permission_id` -> permissions ON DELETE RESTRICT
  (a referenced permission cannot be deleted); index `ix_role_permissions_permission`.
- Seed mapping (reproduces the former role checks): ADMIN = all 15; STAFF = PRODUCT_READ, MACHINE_READ, BATCH_READ, BATCH_CREATE,
  INVENTORY_READ, INVENTORY_WRITE, ORDER_READ.
- Mapped by `Permission` and `RolePermission` (EmbeddedId `RolePermissionId`, like `UserRole`); `Role.permissionGrants` without cascade.
- Role permission replacement locks the `roles` row (PESSIMISTIC_WRITE) and writes `audit_logs` (action ROLE_PERMISSIONS_CHANGED,
  entity_type Role, old/new `{"permissions":[sorted codes]}`, user_id = actor). V1-V12 untouched. ERD: 2 new tables.

## 17. Issue #52 — V14 dispense hardening

- `machine_slots.slot_code` is the physical column: CHECK `slot_code IN ('A','B')`. V14 renamed only unambiguous legacy codes
  (`A1`/`B1`, any case or spaces -> `A`/`B`) and stops with "V14 stopped ..." (changing nothing) when a code names no column or two
  slots of a machine would become the same column. Slots keep their ids, so history is unchanged.
- `dispense_commands.failure_reason` VARCHAR(48): CHECK `(status IN ('FAILED','TIMEOUT')) = (failure_reason IS NOT NULL)` and not blank.
  Extensible string validated in Java (`DispenseFailureReason`): machine reasons of the MQTT contract §6.1, `ABORTED_UNSPECIFIED`,
  `RESULT_TIMEOUT`, `NOT_DELIVERED`; rows failed before V14 were backfilled with `LEGACY_UNKNOWN`.
- Index `ix_dispense_commands_machine_in_flight` (machine_id) WHERE status IN ('SENT','ACKNOWLEDGED').
- **Lock order for dispense**: machine command advisory lock (`pg_advisory_xact_lock(0x46564D03, hashtext(machine_id))`,
  `MachineCommandLockRepository`; first delivery uses the try variant and leaves the command to the sweep) -> Machine row (FOR SHARE
  to publish, FOR UPDATE when the step may put the machine in MAINTENANCE) -> Order -> DispenseCommand -> InventoryItem.
  The payment webhook creates commands without the machine lock and never publishes. Maintenance commands (4.2) must take the same lock.
- System maintenance (`MachineService.enterMaintenanceBySystem`) writes `audit_logs` action `MACHINE_MAINTENANCE_AUTO`, user_id NULL.
  Late dispense results write `DISPENSE_SUCCESS_AFTER_REFUND` / `DISPENSE_LATE_RESULT_CONFLICT` (entity_type DispenseCommand).

## 18. Issue #53 — V15 machine presence

- `machines` gains system-managed `last_heartbeat_at`, `last_offline_at`, `firmware_version` VARCHAR(32), `uptime_seconds` BIGINT,
  `wifi_rssi` SMALLINT, `free_heap_bytes` BIGINT, with CHECKs (uptime >= 0, RSSI -127..0, heap >= 0, firmware not blank). Missing
  diagnostics are NULL, never 0.
- Written only by `MachinePresenceService` with one conditional, forward-only UPDATE per MQTT message (JdbcTemplate,
  `RETURNING old.*` for reboot detection); `updated_at` is never changed by presence. `Machine` maps all presence columns
  (including `last_seen_at`) `insertable = false, updatable = false`, so configuration writes never write them back.
- Lock order: presence touches only the `machines` row (and inserts `sensor_readings` after it in the telemetry path), so it
  serializes with configuration updates (`findForUpdateById`) without deadlock.
- Connectivity (ONLINE / WARNING / OFFLINE / NEVER_SEEN) is derived from last_seen_at / last_offline_at with `app.machine-health`
  thresholds and never stored; the list filter uses the same rules as SQL predicates.
- `sensor_readings` rows come from MQTT telemetry (receive time, 2 decimals, -40..85 °C, 0..100 %RH); reads use
  `ix_sensor_readings_machine_time`. Machines with readings cannot be deleted (RESTRICT, unchanged).

## 19. Issue #56 — V16 machine event logging

- `machine_events.source` VARCHAR(16) NOT NULL DEFAULT 'MACHINE', CHECK MACHINE/BACKEND; `message_id` VARCHAR(64), CHECK: required and
  not blank for MACHINE, optional (NULL) for BACKEND. Pre-V16 rows (none expected) are marked BACKEND.
- Partial UNIQUE `uq_machine_events_machine_message (machine_id, message_id) WHERE message_id IS NOT NULL`: one row per machine
  message (insert with ON CONFLICT DO NOTHING). Index `ix_machine_events_machine_type_time (machine_id, event_type, created_at DESC)`.
- Writes only through `MachineEventWriter` (JdbcTemplate INSERT), in a transaction of its own (`MachineEventRecorder`, REQUIRES_NEW);
  backend events are written AFTER_COMMIT of the deciding transaction. `MachineEvent` and `AuditLog` are `@Immutable`;
  `MachineEventRepository` and `AuditLogRepository` are plain Repositories without update/delete methods (append-only by policy).
- Permission `AUDIT_LOG_READ` (20000000-0000-0000-0000-000000000016) granted to ADMIN only.

## 20. Issue #58 — V17 alerts and notifications

- `alerts`: slot_id with composite FK (slot_id, machine_id) → machine_slots, error_code (CHECK `^[A-Z][A-Z0-9_]{1,63}$`),
  dedupe_key NOT NULL (pre-V17 rows backfilled `LEGACY:{id}`), acknowledged_at/acknowledged_by (CHECK both NULL or at >= triggered_at),
  resolution_note (not blank). Type HARDWARE_FAULT added.
- Partial UNIQUE `uq_alerts_open_dedupe (dedupe_key) WHERE status <> 'RESOLVED'`: at most one unresolved alert per problem. Writes go
  through `AlertWriter` (INSERT ON CONFLICT DO NOTHING RETURNING id; system resolve UPDATE … WHERE status <> 'RESOLVED', resolved_by NULL).
  Manual acknowledge/resolve lock the row (PESSIMISTIC_WRITE); a resolved alert is 409.
- `notifications` (user_id → users ON DELETE CASCADE, alert_id → alerts RESTRICT, severity CHECK, read_at >= created_at); one row per
  ACTIVE ALERT_NOTIFY user per new alert, inserted AFTER_COMMIT of the alert in its own transaction.
- Permissions ALERT_READ (…017), ALERT_MANAGE (…018) → ADMIN and STAFF; ALERT_NOTIFY (…019) → ADMIN.
- Health check (`app.health-check.*`) holds `pg_try_advisory_xact_lock(0x46564D, 4)` for the run; each machine in REQUIRES_NEW.

## 21. Issue #61 — V18 near-expiry discount pricing

- `pricing_settings`: exactly one row (singleton UNIQUE + CHECK), seeded enabled / 50; percent CHECK 1..90; `version` is the
  optimistic value the Admin sends back (409 when stale; the row is also locked PESSIMISTIC_WRITE while updating); `updated_by` → users.
  Changes write audit_logs action PRICING_NEAR_EXPIRY_UPDATED, entity_type PRICING_SETTINGS, old/new {enabled, percent}, user, ip.
- `orders.discount_amount` NUMERIC(12,2) NOT NULL DEFAULT 0, CHECK 0 <= discount_amount <= subtotal AND total_amount = subtotal - discount_amount.
  Meaning: subtotal = sum of original prices, total_amount = amount charged (payment amount, unchanged).
- `order_items.original_unit_price` NOT NULL (backfilled = unit_price), `discount_percent` SMALLINT 0..90, `discount_reason` NONE/NEAR_EXPIRY,
  CHECK unit_price <= original_unit_price and NONE <=> percent 0 and unit = original.
- V18 stops with a clear error if any existing order has total_amount <> subtotal (never rewrites charged amounts).
- Price decided in `OrderService.createOrder` from the bowl locked by `selectHead` (NearExpiryPricingService, business day in
  `app.business-zone`); never recalculated. Catalog SQL applies the same rule with dayStart/dayEnd/percent parameters.
- Permissions PRICING_READ (…020) → ADMIN, STAFF; PRICING_MANAGE (…021) → ADMIN. Partial index ix_orders_discounted_time.

## 22. Issue #64 — V19 maintenance commands

- `maintenance_commands` (see table list): command_code `MC-<32 hex>` (CHECK, firmware limit 39), operation REMOVE_ITEM / EMPTY_COLUMN /
  OPEN_REFILL / CLOSE_REFILL / RESET (RESET has no slot, the others do; composite FK (slot_id, machine_id)), status PENDING / SENT /
  ACCEPTED / COMPLETED / FAILED / NEEDS_RECONCILIATION / RECONCILED, reason required to remove bowls (OTHER needs a non-blank note),
  REMOVE_ITEM stores the head bowl at creation (target_inventory_item_id), UNIQUE (requested_by, idempotency_key), RECONCILED <=>
  outcome + reconciled_at + reconciled_by.
- Partial UNIQUE `uq_maintenance_commands_open (machine_id) WHERE status IN (PENDING, SENT, ACCEPTED)`: one unfinished command per machine.
- `machine_slots.refill_gate_open` BOOLEAN NOT NULL DEFAULT FALSE: set/cleared by completed OPEN/CLOSE_REFILL; such a slot is excluded
  from the catalog and head selection and cannot be set ACTIVE.
- Effects only on COMPLETED or reconciliation DONE, under the machine command advisory lock (shared with dispense), then Slot, command
  row, InventoryItems in id order: bowls become REMOVED (removed_at) with one inventory_transactions REMOVE row each (reference_id =
  command id, performed_by = requester, reason "MAINTENANCE_<OP> <REASON>[: note]"). Batch quantities and machine/slot status never change.
- Reconciliation writes audit_logs MAINTENANCE_COMMAND_RECONCILED. Dispense publishing waits while a maintenance command is unfinished.
- Permissions MAINTENANCE_COMMAND_READ (…022), MAINTENANCE_COMMAND_EXECUTE (…023) → ADMIN, STAFF; MACHINE_RESET (…024) → ADMIN.

## 23. Issue #66 — V20 work orders

- `work_orders`: code `WO-yyyyMMdd-XXXX` (business-zone date, 4 Crockford base32, CHECK), type RESTOCK / MAINTENANCE / INCIDENT, source
  MANUAL / ALERT / SCHEDULE / CUSTOMER_REPORT, priority LOW..URGENT, status OPEN / ASSIGNED / IN_PROGRESS / DONE / CANCELLED. CHECKs: OPEN
  has no assignee and every other unfinished/done status has one; started_at set exactly for IN_PROGRESS/DONE; DONE needs completed_at,
  completed_by and a non-blank result_note; CANCELLED needs cancelled_at and a non-blank cancel_reason (COALESCE so NULL fails); times
  ordered. `version` (@Version) is the optimistic value sent back on edit / assign / unassign / cancel.
- `work_order_alerts` (PK work_order_id, alert_id): kept as history; "one unfinished work order per alert" is enforced by WorkOrderService
  under the alert row lock (findActiveLinks).
- `work_order_events`: append-only (trigger `work_order_events_append_only`, like inventory_transactions); one row per action, actor NULL = system.
- `notifications.work_order_id` (nullable FK): work order notifications, created AFTER_COMMIT in their own transaction.
- Start locks: machine command advisory lock, Machine row, WorkOrder row; RESTOCK/MAINTENANCE (INCIDENT on request) call
  MachineService.enterMaintenanceBySystem with reason `WORK_ORDER <code>`. Machine reactivation is refused while a work order is IN_PROGRESS.
- Permissions WORK_ORDER_READ_ALL (…025) → ADMIN, WORK_ORDER_READ_ASSIGNED (…026) → ADMIN, STAFF, WORK_ORDER_MANAGE (…027) → ADMIN,
  WORK_ORDER_EXECUTE (…028) → ADMIN, STAFF.

## 24. Issue #68 — V21 restock workflow

- `restock_lines`: one per (work order, slot, product) (UNIQUE), composite FK (slot_id, machine_id) → machine_slots (machine_id must equal the
  work order's machine: service), planned/loaded 0..1000, variance_reason non-blank when set. `loaded_quantity` is a cached counter equal to
  the LOAD inventory_transactions with reference_id = line id; it is never decreased.
- `maintenance_commands.work_order_id` (nullable FK): the IN_PROGRESS work order a command serves; REMOVE history keeps reference_id = command id.
- Partial index `ix_inventory_transactions_reference (reference_id)`.
- Loading core `InventoryLoader` (shared by direct loading and restock): caller holds Product -> Batch -> Machine -> Slot; capacity and batch
  declared quantity checked under those locks; restock bowls get loaded_at = now + i µs (strict FIFO).
- Permissions RESTOCK_PLAN (…029) → ADMIN, RESTOCK_EXECUTE (…030) → ADMIN, STAFF, INVENTORY_LOAD_DIRECT (…031) → ADMIN; POST
  /api/v1/inventory/load now needs INVENTORY_LOAD_DIRECT (STAFF keeps INVENTORY_WRITE for removals).

## 25. Issue #70 — V22 maintenance plans

- `maintenance_plans`: interval 1..365, lead 0..30 and < interval, due_time TIME (local time in the business zone, default 17:00),
  next_due_date DATE (business-zone date), active, last_completed_at, created_by, version (optimistic, sent back on PATCH). Never deleted.
- `work_orders.maintenance_plan_id` + `scheduled_for`: CHECK source = SCHEDULE <=> both set; plan only on MAINTENANCE; partial UNIQUE
  (plan, scheduled_for) and (plan) while OPEN / ASSIGNED / IN_PROGRESS -> generation is idempotent.
- Generation (MaintenancePlanScheduler): pg_try_advisory_xact_lock(0x46564D, 5) for the run, each plan REQUIRES_NEW under its row lock;
  WorkOrderService.createScheduled (created_by NULL). Missed runs create only the current occurrence.
- Next due (MaintenancePlanWorkOrderListener, AFTER_COMMIT + REQUIRES_NEW): DONE -> completion date + interval and last_completed_at;
  CANCELLED -> scheduled_for + interval; a later date already set is kept.
- Permissions MAINTENANCE_PLAN_READ (…032) -> ADMIN, STAFF; MAINTENANCE_PLAN_MANAGE (…033) -> ADMIN. Plan changes audited (MAINTENANCE_PLAN_*).
