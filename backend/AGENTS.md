# Fruit Vending Machine Backend - AI Development Harness

## 1. Project

This repository contains the backend for an IoT-based automatic fruit
vending machine system.

Technology:

- Java 21
- Spring Boot
- Maven
- PostgreSQL 18
- Flyway
- Spring Data JPA
- Spring Security
- MQTT
- ESP32
- REST API

The system supports:

- ADMIN and STAFF
- Products
- Product batches
- Individual fruit bowl inventory
- Vending machines
- Machine slots
- Temperature/humidity monitoring
- Expiration tracking
- Orders
- QR payments
- Dispensing
- Alerts
- Reports

---

## 2. Source of Truth

Database schema:

src/main/resources/db/migration/

Flyway migrations are the source of truth for database structure.

Never use Hibernate to modify the schema.

Required configuration:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
```

Never change an already-applied Flyway migration.

Create a new migration for every schema change.

---

## 3. Architecture

Use feature-based packages.

Example:

```text
product/
├── controller/
├── dto/
├── entity/
├── repository/
└── service/
```

Do NOT reorganize the project into global:

```text
controller/
service/
repository/
entity/
```

unless explicitly requested.

---

## 4. Dependency Direction

Normal request flow:

```text
Controller
    ↓
Service
    ↓
Repository
    ↓
PostgreSQL
```

Controllers must not access repositories directly.

Business logic belongs in services.

Repositories are responsible only for persistence/query operations.

Entities must not contain controller/API logic.

---

## 5. Database Rules

Use:

- UUID for business entity IDs
- TIMESTAMPTZ / Instant for absolute timestamps; UTC storage/API conventions
- BigDecimal for money
- EnumType.STRING for application enums

Never use:

- float/double for money
- plaintext passwords
- ddl-auto=update
- ddl-auto=create

Do not blindly use CascadeType.ALL.

Historical records must be preserved.

---

## 6. Entity Rules

Do not use Lombok @Data on JPA entities.

Prefer:

```java
@Getter
@Setter
@NoArgsConstructor
```

Avoid relationships inside toString(), equals(), and hashCode().

Database mappings must match Flyway exactly.

Do not change the database merely to make an entity mapping easier.

---

## 7. API Rules

Base path:

```text
/api/v1
```

Use DTOs for API input/output.

Never expose JPA entities directly from controllers.

Use Jakarta Validation for request validation.

Use the project's global exception handler.

---

## 8. Security Rules

Passwords must be hashed.

Never log:

- passwords
- JWT secrets
- payment secrets
- payment signatures
- database passwords
- MQTT credentials

ADMIN and STAFF permissions must be enforced by backend security,
not only by the frontend.

---

## 9. Payment Rules

The backend is the authority for payment status.

Never trust payment success reported by:

- touchscreen
- ESP32
- frontend

Payment success must be verified through the payment provider.

Webhook processing must be idempotent.

Never dispense based solely on client-reported payment status.

---

## 10. IoT Rules

Dispensing uses Backend -> Kiosk -> Serial/USB -> ESP32. The kiosk reports the
correlated ESP32 result to backend. MQTT is optional for future telemetry/events,
not the dispense transport in the approved flow.

ESP32 must never decide whether an order is paid.

Backend creates/authorizes dispense commands only after payment verification.
Kiosk must use the backend-issued command ID and assigned slot. Backend validates
machine ownership and result transitions idempotently before changing inventory/order.

Every dispense command must have a unique command ID.

Dispense processing must account for:

- acknowledgement
- success
- failure
- timeout
- duplicate messages

---

## 11. Inventory Rules

Each inventory item represents ONE physical fruit bowl.

Relationship:

```text
Product
   ↓
ProductBatch
   ↓
InventoryItem
   ↓
MachineSlot
```

Never model inventory only as:

```text
slot.quantity
```

Inventory status must be traceable.

Expired inventory must never be sold.

---

## 12. Git Workflow

Stable development branch:

```text
dev
```

Every issue gets its own branch.

Format:

```text
feature/<issue-number>-<description>
fix/<issue-number>-<description>
```

Example:

```text
feature/3-user-role-persistence
fix/24-duplicate-payment-webhook
```

Normal workflow:

```text
Issue
  ↓
Branch from dev
  ↓
Implementation
  ↓
Tests
  ↓
Pull Request
  ↓
Review
  ↓
Merge into dev
```

Do not work directly on dev.

---

## 13. AI Coding Rules

Before implementing an issue:

1. Read this file.
2. Read `.ai/PROJECT.md`.
3. Read `.ai/ARCHITECTURE.md`.
4. Read `.ai/DATABASE.md`.
5. Read `.ai/CODING_RULES.md`.
6. Read `.ai/CURRENT_TASK.md`.
7. Inspect relevant existing code.
8. Inspect relevant Flyway migrations.

Before changing code, report:

- understanding of the task
- files expected to change
- database impact
- potential risks

Implement ONLY the current issue.

Do not implement future issues.

Do not perform unrelated refactoring.

Do not modify existing Flyway migrations.

Do not introduce new dependencies without explaining why.

---

## 14. Verification

After implementation:

1. Compile the project.
2. Run tests.
3. Verify Flyway.
4. Verify Hibernate schema validation.
5. Check for unrelated changes.
6. Report changed files.
7. Report tests executed.
8. Report remaining risks.

An issue is NOT complete merely because the code compiles.

---

## 15. Current Work

The current GitHub issue is defined in:

`.ai/CURRENT_TASK.md`

That file defines the implementation scope.

When the user supplies an issue, the agent updates CURRENT_TASK.md with the actual
issue link/number, scope, acceptance criteria, non-goals, database impact and verification.
Do not invent issue numbers or treat an empty task file as authorization for future work.
An explicit non-issue maintenance request is scoped by the user's request; do not
overwrite CURRENT_TASK.md with an invented issue.

Keep the approved feature package-info.java placeholders. Shared mapped superclasses
belong in common.entity; domain entities/enums belong in their owning feature.
Do not modify apps/kiosk or firmware unless the user explicitly changes that restriction.

Never expand beyond that scope without explicit approval.
