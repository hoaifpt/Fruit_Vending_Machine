# Database Design — current Flyway schema

## 1. Authority and status

PostgreSQL 18; Flyway V1–V9 under `src/main/resources/db/migration/` (relative to
the backend module). These migrations define the current schema, not a proposed model.
There are **19 business tables** plus `flyway_schema_history` (Flyway infrastructure,
not a JPA business entity). Detailed constraints and ERD also appear in
[database-migration.md](../../docs/database-migration.md); mappings are described in
[jpa-entities.md](../../docs/jpa-entities.md). SQL remains authoritative.

Hibernate uses `ddl-auto=validate`, `generate-ddl=false`; SQL initialization is disabled.
Validation is not a full audit of CHECK/index/trigger/nullability definitions.
Never edit an applied migration. A genuine schema change needs a new V10+ migration.
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
| orders | id, order_code, machine_id, status, subtotal, total_amount, created_at, paid_at, completed_at, cancelled_at |
| order_items | id, order_id, product_id, quantity, unit_price, total_price, created_at |
| order_item_allocations | id, order_item_id, inventory_item_id, status, created_at, updated_at, released_at |
| payments | id, order_id, provider, transaction_id, payment_reference, amount, status, qr_code, created_at, paid_at, expired_at |
| payment_webhook_logs | id, provider, event_type, order_code, raw_payload, raw_body, signature, is_verified, received_at |
| dispense_commands | id, command_code, order_id, machine_id, slot_id, inventory_item_id, status, sent_at, acknowledged_at, completed_at, created_at, updated_at |
| inventory_transactions | id, inventory_item_id, machine_id, slot_id, type, reference_id, performed_by, created_at, reason, status_before, status_after |
| machine_events | id, machine_id, event_type, payload, created_at |
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
Integration tests use PostgreSQL 18 Testcontainers, apply all nine migrations, run Flyway
validation and Hibernate validation, and check all 19 entity mappings. Never use update/create
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
