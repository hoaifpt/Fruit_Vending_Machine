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
