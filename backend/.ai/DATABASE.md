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
| machines | id, code, name, location, status, temperature_min, temperature_max, humidity_min, humidity_max, last_seen_at, created_at, updated_at |
| machine_slots | id, machine_id, slot_code, capacity, status, created_at, updated_at |
| products | id, sku, name, description, price, image_url, status, created_at, updated_at |
| product_batches | id, batch_code, product_id, manufactured_at, expires_at, quantity, created_by, created_at |
| inventory_items | id, batch_id, slot_id, status, loaded_at, reserved_at, sold_at, removed_at, created_at, updated_at |
| sensor_readings | id, machine_id, temperature, humidity, recorded_at |
| alerts | id, machine_id, type, severity, title, message, status, triggered_at, resolved_at, resolved_by, created_at, updated_at |
| orders | id, order_code, machine_id, status, subtotal, total_amount, created_at, paid_at, completed_at, cancelled_at, expires_at (V11, nullable reservation deadline) |
| order_items | id, order_id, product_id, quantity, unit_price, total_price, created_at |
| order_item_allocations | id, order_item_id, inventory_item_id, status, created_at, updated_at, released_at |
| payments | id, order_id, provider, transaction_id, payment_reference, amount, status, qr_code, created_at, paid_at, expired_at |
| payment_webhook_logs | id, provider, event_type, order_code, raw_payload, raw_body, signature, is_verified, received_at |
| dispense_commands | id, command_code, order_id, machine_id, slot_id, inventory_item_id, status, sent_at, acknowledged_at, completed_at, created_at, updated_at |
| inventory_transactions | id, inventory_item_id, machine_id, slot_id, type, reference_id, performed_by, created_at, reason, status_before, status_after |
| machine_events | id, machine_id, event_type, payload, created_at |
| kiosk_credentials | id, machine_id, key_prefix, secret_hash, status, created_by, created_at, revoked_by, revoked_at |
| audit_logs | id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, created_at |

## 4. Relationships and integrity

- User -> UserRole <- Role. Deleting a user cascades only its membership rows at DB
  level; role deletion is RESTRICT. Prefer deactivation. JPA does not cascade REMOVE/ALL.
  Seed V8 contains ADMIN/STAFF reference roles only, no accounts or passwords.
- Machine -> MachineSlot, SensorReading, Alert, MachineEvent and Order.
  Slots have UNIQUE(machine_id, slot_code), capacity > 0 and UNIQUE(id, machine_id).
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
| alerts.type | HIGH_TEMPERATURE, LOW_TEMPERATURE, HIGH_HUMIDITY, MACHINE_OFFLINE, PRODUCT_EXPIRED, PRODUCT_EXPIRING, DISPENSE_FAILED, LOW_STOCK |
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
