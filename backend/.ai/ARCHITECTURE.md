# Backend Architecture

## 1. Architecture Style

The backend uses a modular monolith with feature-based packages.

The project is NOT currently a microservice architecture.

Do not introduce microservices unless the architecture is explicitly changed.

---

## 2. Base Package

Current base package:

```text
com.fruitmachine.backend
```

Current high-level structure:

```text
com.fruitmachine.backend
│
├── alert/
├── audit/
├── auth/
├── common/
├── config/
├── dispense/
├── inventory/
├── machine/
├── mqtt/
├── order/
├── payment/
├── product/
├── security/
├── sensor/
├── user/
│
└── BackendApplication.java
```

Feature packages may add subpackages when required.

Example:

```text
product/
├── controller/
├── dto/
├── entity/
├── repository/
└── service/
```

Do not create unused layers simply for symmetry.

Keep approved package-info.java placeholders. Domain entities and enums live under
<feature>.entity and <feature>.enums, including audit.entity.AuditLog. Shared timestamp/UUID
mapped superclasses live in common.entity. Cross-feature entity associations follow
actual Flyway FKs; this package refactor does not change their ownership or mappings.

---

## 3. Common Packages

### common

Contains reusable application components such as:

```text
common/
├── entity/
├── exception/
├── response/
└── util/
```

Only genuinely shared components belong here.

Do not turn `common` into a dumping ground.

### config

Contains Spring/application configuration.

Examples:

- JPA configuration
- auditing configuration
- application beans
- later MQTT/payment configuration where appropriate

### security

Contains cross-cutting Spring Security infrastructure.

Implemented by issue #6:

- stateless Spring Security configuration; BCrypt AuthenticationManager
- JOSE/Nimbus HS256 JWT service and authentication filter
- UserDetails adapter loading current account/roles through existing repositories
- common JSON authentication entry point / access-denied handler

Issue #10 enables @EnableMethodSecurity in existing SecurityConfig. Reuse the current
CustomUserDetailsService/AuthenticatedUser mapping and current DB roles for every JWT
request, no duplicate filter/role model or implicit ADMIN > STAFF hierarchy. Future
Spring-managed use-case entry points use @PreAuthorize with ADMIN, STAFF, either or
isAuthenticated; invocation must cross the Spring proxy. No production role-protected
business operation is invented in this issue. See ../../docs/admin-staff-authorization.md.

### auth

Contains authentication use cases.

Current and future use cases:

- email/password login and access-token creation (issue #6)
- refresh token flow only if explicitly assigned in a later issue (not implemented)

`auth` and `security` are intentionally different:

```text
auth
→ authentication use cases

security
→ security infrastructure
```

---

### user bootstrap (issue #8)

`user/bootstrap/InitialAdminBootstrap` is an ApplicationRunner delegating to a
transactional service, separate from auth/security infrastructure. Typed properties live
in config/properties; AccountCredentialPolicy is reusable for account creation only.
UserRepository performs efficient ADMIN-role existence checks; UserRoleRepository saves
the explicit membership without changing shared-role cascades. BootstrapLockRepository
acquires a PostgreSQL transaction advisory lock on the same JpaTransactionManager
datasource connection; READ_COMMITTED rechecks after the lock. No schema changes.
Existing ADMIN (any status) skips validation and all writes; configuration cannot reset
passwords/reactivate users/promote STAFF. See ../../docs/initial-admin-bootstrap.md.

### user management (issue #12)

UserController uses dedicated strict request DTOs, common ApiResponse and safe UserResponse/
UserPageResponse; UserService owns transactions, credential/role assignment and lifecycle rules.
Existing repositories, JWT and @PreAuthorize ADMIN infrastructure are reused. Actual users
HTTP paths also require ADMIN before MVC validation. Lists page root users in PostgreSQL,
then graph-fetch roles only for page IDs; never paginate a collection fetch. Status/role
filters combine without duplicate roots. Existing extensible role strings remain intact.
AccountCredentialPolicy is shared with bootstrap; safe validation errors are adapted at
each boundary without changing bootstrap provisioning rules. Login/create strip/lowercase
email before validation; passwords remain unchanged. No schema/dependency change.
UserStatusLockRepository reserves FVM advisory transaction operation 2 for status decisions;
READ_COMMITTED reloads actor after locking, prevents concurrent cross-disable, and guards
self/last ACTIVE ADMIN. Profile/status writes use a user row lock to avoid stale updates.
See ../../docs/user-management.md and repository api-contract/api.yaml.

### product management (issue #14)

ProductController -> ProductService -> ProductRepository reuses existing Product entity
and enum (no schema change). Separate strict DTOs reject unknown/immutable fields; service
validation, transactions and ADMIN/STAFF method guards reuse existing infrastructure.
JpaSpecificationExecutor combines status + literal lowercased name/SKU substring matching;
PageRequest and approved Spring Sort provide DB paging plus UUID tie-break, no collection fetch.
Profile/status writes acquire PESSIMISTIC_WRITE to avoid stale cross-field overwrites.
SKU strip/uppercase is stable and immutable; positive BigDecimal has NUMERIC(12,2) bounds,
no silent rounding. Mapper exposes catalog fields only; no batch/inventory/slot workflows.
OpenApiConfig supplies Products examples/headers; versioned api-contract/api.yaml is kept
consistent by ProductManagementDocumentationTest. See ../../docs/product-management.md.

### machine management (issue #17)

MachineController -> MachineService -> MachineRepository reuses existing Machine/MachineStatus
and Flyway V2 without schema/dependency changes. Strict feature DTOs, explicit mapper,
ADMIN writes/ADMIN-STAFF reads, DB page/status/literal code-name-location search and
approved sorting follow existing Product conventions. POST explicitly sets INACTIVE;
code normalized/immutable, lastSeenAt system-managed. BigDecimal thresholds enforce
schema bounds/two decimals and strict minimum < maximum. Configuration/status writes
lock the row and preserve related history; no slots/inventory/telemetry workflows.
Swagger examples/headers and api-contract/api.yaml agree through Machine documentation tests.
See ../../docs/machine-management.md.

### machine slot management (issue #18)

MachineSlotController -> MachineSlotService -> MachineSlotRepository uses existing
MachineRepository for parent validation. Scoped nested lookups enforce both IDs.
MachineSlot/SlotStatus and Flyway unchanged; normalized immutable per-machine code,
positive Integer capacity, explicit ACTIVE registration and independent slot status.
Strict feature DTO deserializers reject integer truncation and enum ordinal coercion
without changing JSON behavior in other features. DB page/status/sort queries, UUID
tie-break, slot row locks and explicit mapper preserve identity/concurrent changes/history.
Parent UUID mapping works before the read-only FK mirror is hydrated on creation.
Existing nested machine HTTP guards and feature method guards enforce ADMIN writes/
ADMIN-STAFF reads. No stock/product/hardware workflow added.
Machine Swagger customization is restricted to its three exact paths; Slot customization
is separate. Contract/doc consistency tests preserve previous Machine operations.
See ../../docs/machine-slot-management.md.

### product batch management (issue #21)

product.batch controller/service/repository/DTO/mapper layers reuse product.entity.ProductBatch
and existing Product/User mappings. No relocation/schema change. ADMIN/STAFF create/read,
strict creator-free request, current AuthenticatedUser creator, normalized immutable code,
positive declared quantity and Clock-based future expiry checks on microsecond UTC instants.
Existing Product PESSIMISTIC_WRITE query serializes active-product checks with deactivation.
Repository fetches only to-one product for database pages/detail, avoiding collection
paging/N+1; approved sorts plus UUID tie-break. No update/delete/inventory/stock workflows.
Separate Swagger customizer and api-contract consistency tests; see ../../docs/product-batch-management.md.

## 4. Layer Responsibilities


Normal request flow:

```text
HTTP Request
     ↓
Controller
     ↓
Service
     ↓
Repository
     ↓
PostgreSQL
```

### Controller

Responsible for:

- HTTP mapping
- request validation
- calling application services
- converting service result into API response

Must not contain domain workflows.

### Service

Responsible for:

- business rules
- state transitions
- transactions
- coordination between repositories
- coordination with integrations

### Repository

Responsible for:

- persistence
- queries

### Entity

Represents persistent domain state mapped to the Flyway schema.

### DTO

Represents API/application boundary data.

JPA entities must not be exposed directly through public REST APIs.

---

## 5. Database Ownership

PostgreSQL schema is managed by Flyway.

```text
Flyway
   ↓
PostgreSQL Schema
   ↑
Hibernate validates
```

Hibernate does not own schema creation.

Configuration:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
```

---

## 6. Domain Relationships

High-level domain model:

```text
Users
  │
  └── Roles


Machines
  │
  ├── MachineSlots
  ├── SensorReadings
  ├── MachineEvents
  └── Alerts


Products
  │
  └── ProductBatches
          │
          └── InventoryItems
                    │
                    └── MachineSlot


Orders
  │
  ├── OrderItems
  │       └── OrderItemAllocations -> InventoryItems
  └── Payments


Orders
  │
  └── DispenseCommands
```

Inventory transactions and audit logs provide traceability.

---

## 7. Inventory Architecture

Inventory must preserve physical item identity.

```text
Product
    ↓
ProductBatch
    ↓
InventoryItem
    ↓
MachineSlot
```

An `InventoryItem` represents one bowl.

Slot quantity should be derived from inventory state when possible rather than being the sole source of truth.

Saleable inventory requires more than AVAILABLE. Illustrative selection predicate
(reservation must additionally lock/recheck rows and enforce capacity/allocation rules):

```text
item.slot_id = requested_slot
AND item.status = AVAILABLE
AND batch.expires_at > current_instant
AND product.status = ACTIVE
AND slot.status = ACTIVE
AND machine.status = ACTIVE
```

Join batch/product/slot/machine to evaluate those conditions. Stockroom AVAILABLE items
with no slot are not sellable at a machine. Capacity counts physical occupants with
AVAILABLE/RESERVED/EXPIRED/DISPENSE_FAILED, not just sellable items; sold/removed rows
retain their last slot for history but do not occupy capacity. Recheck expiry before
fulfillment; expiration jobs are not the safety boundary.

---

## 8. Order Architecture

Target order lifecycle:

```text
PENDING_PAYMENT
       ↓
      PAID
       ↓
   DISPENSING
       ↓
   COMPLETED
```

Failure/alternative states may include:

```text
CANCELLED
PAYMENT_FAILED
DISPENSE_FAILED
REFUNDED
```

State transitions must be controlled by services.

Clients must not arbitrarily assign order states.

---

## 9. Payment Architecture

Target architecture:

```text
OrderService
     ↓
PaymentService
     ↓
PaymentProvider
       ├── PayOS
       ├── MoMo
       └── VNPay
```

Provider-specific code must not leak throughout the business layer.

Webhook flow:

```text
Provider
   ↓
Webhook Endpoint
   ↓
Verify signature
   ↓
Persist/inspect webhook
   ↓
Resolve Payment
   ↓
Idempotency check
   ↓
Update Payment
   ↓
Update Order
```

---

## 10. MQTT Architecture

MQTT is an integration boundary.

Preferred flow:

```text
MQTT message
     ↓
MQTT listener
     ↓
Application Service
     ↓
Business logic
     ↓
Repository
```

Do not implement business workflows directly inside MQTT callbacks.

Future outbound telemetry/event integration (not a dispense transport):

```text
Application Service
     ↓
MQTT Publisher
     ↓
Broker
     ↓
Authenticated machine/kiosk integration
```

---

## 11. Dispense Architecture

Target flow:

```text
Verified Payment
      ↓
Order PAID
      ↓
Create DispenseCommand
      ↓
Backend exposes authorized commandId/slot to owning kiosk
      ↓
Kiosk sends DISPENSE <commandId> <slot=A2> over Serial/USB
      ↓
Machine attempts dispense
      ↓
ESP32 reports result to kiosk with the same commandId
      ↓
Kiosk reports correlated result to backend
      ↓
Backend verifies command
      ↓
Update command/order/inventory
```

Command processing must tolerate duplicate Serial results and duplicate kiosk reports.
PAID is a backend-confirmed state, not a client-created authorization. Backend owns
command creation and slot/item selection. Authenticate kiosk, verify owning machine,
payment, allocation and legal state before applying a result in a transaction.

For multi-item orders, success marks the corresponding allocation DISPENSED and item
SOLD with history; Order becomes COMPLETED only when all required commands succeeded.
Pending fulfillment uses DISPENSING. Do not automatically retry ambiguous outcomes
after timeout/disconnect: reconcile to avoid dispensing a second bowl.

A command must be uniquely identifiable.

---

## 12. Transactions

Use service-layer transaction boundaries.

Example:

```java
@Transactional
public void reserveInventory(...) {
}
```

A transaction should protect logically atomic database operations.

Do not hold database transactions open while waiting for:

- payment providers
- MQTT responses
- ESP32
- long-running external operations

External asynchronous workflows should use persisted states.

---

## 13. External System Trust Boundaries

The backend must treat the following as untrusted inputs:

- Web requests
- Touchscreen requests
- ESP32 messages
- MQTT messages
- Payment webhooks until verified

Validate external data before changing business state.

---

## 14. Deletion Strategy

Historical data must be preserved.

Prefer disabling/deactivation for:

- users
- products
- machines

Avoid cascading deletion into:

- orders
- payments
- inventory transactions
- audit logs
- dispense history

---

## 15. Future Scalability

The current architecture is intentionally a modular monolith.

Do not prematurely split modules into services.

Module boundaries should remain clean enough that extraction is possible later if actually required.

## 16. Inventory Management — Issue #22

inventory owns controller/dto/service/repository/mapper and reuses existing entities.
All eight management operations require ADMIN or STAFF at HTTP and service boundaries.
Load/remove and per-item immutable history commit atomically. Product/Batch/Machine/Slot
locks serialize capacity, batch quantity and configuration changes; removal uses Slot/Item.
Database specifications/page wrappers and to-one entity graphs avoid collection paging/N+1.
Slot summary derives occupancy, expiry, availability and sellability without stock counters.
Only forward-only V9 extends history with reason/status snapshots after real schema audit.
Orders/reservations/payments/dispense/schedulers are future scope. API details and local
Swagger setup: [inventory-management.md](../../docs/inventory-management.md).

## 17. Core integration testing — Issue #24

Test-only support/TestPostgres centralizes disposable PostgreSQL18 configuration for
existing suites. AbstractCoreIntegrationTest provides profile test, dynamic DB/JWT and
MockMvc; TestDataFactory establishes unique roots through existing HTTP controllers.
Core tests cover cross-domain flow, actual SQL faults/rollback, observed overlapping
transactions and DB constraints. Contexts/containers dispose after class; append-only
history is isolated by unique fixtures rather than erased between methods. Existing
feature tests remain regression coverage, all discovered by Surefire *Test in clean verify.
CI workflow uses Java21/Docker and publishes reports even on failure. No production API,
mapping/migration/dependency change. See ../../docs/core-integration-testing.md.
