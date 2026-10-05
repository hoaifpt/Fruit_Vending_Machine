# Fruit Vending Machine System - Project Context

## 1. Overview

The Fruit Vending Machine System is an IoT-based vending platform for selling prepared fruit bowls.

The system consists of:

```text
Kiosk / Touchscreen ── Serial/USB ── ESP32 / Motors / Sensors
        │
        │ REST / backend status channel
        ▼
     Backend ── PostgreSQL
        ├────── Payment Provider (verified webhook)
        └────── Management Web Application
```

The backend is responsible for business logic, inventory, machine management, environmental monitoring, orders, payments and dispensing coordination.

---

## 2. Hardware

Each vending machine may contain:

- ESP32 controller
- Touchscreen
- Refrigerated compartment
- Temperature sensor
- Humidity sensor
- Product slots
- Motor/servo dispensing mechanism
- Sensors required to detect machine/dispensing state

The machine does NOT accept cash.

Payment is performed electronically using QR-based payment.

---

## 3. User Types

The management system currently supports:

### ADMIN

Responsible for:

- user management
- machine management
- product management
- system monitoring
- inventory oversight
- payment monitoring
- reports
- configuration

### STAFF

Responsible for operational activities such as:

- viewing assigned/available machines
- inventory management
- refilling products
- managing product batches
- monitoring expiration
- monitoring temperature/humidity
- handling operational alerts

Authorization rules will be implemented in dedicated issues.

---

## 4. Customer Purchase Flow

Target purchase flow:

```text
1. Customer selects products on kiosk
2. Kiosk -> POST /api/v1/orders
3. Backend checks/reserves inventory and creates Order = PENDING_PAYMENT
4. Backend creates QR payment
5. Kiosk displays QR
6. Customer pays
7. Payment Provider -> Webhook -> Backend
8. Backend verifies payment -> Order = PAID
9. Kiosk receives backend-confirmed PAID and a backend-issued dispense command
10. Kiosk -> Serial/USB: DISPENSE <commandId> <slot=A2>
11. ESP32 drives motor and checks physical result
12. ESP32 -> Kiosk: DISPENSE_SUCCESS <commandId>
13. Kiosk -> Backend: correlated dispense result
14. Backend validates result and atomically updates:
    DispenseCommand = SUCCESS, InventoryItem = SOLD, Order = COMPLETED
```

The backend is authoritative for order and payment state.

Kiosk relays only a backend-authorized command after verified payment; it cannot
invent command IDs, select a different slot, or mark an order PAID. Backend creates
and persists DispenseCommand before exposing it to the kiosk. The exact claim/status
channel will be designed in its issue; polling/push transport is not implemented yet.

For multiple bowls, one command targets one allocated inventory item. Complete the
order only after all required commands succeed; record per-item results idempotently.
Use the existing DISPENSING state while fulfillment is in progress. Failure, timeout,
disconnect and ambiguous physical outcomes require reconciliation, not blind resend.

---

## 5. Inventory Model

Inventory is tracked at the individual fruit bowl level.

```text
Product
   ↓
ProductBatch
   ↓
InventoryItem
   ↓
MachineSlot
   ↓
Machine
```

Example:

```text
Mixed Fruit Bowl
       │
       └── Batch B20261003
               │
               ├── InventoryItem #1
               ├── InventoryItem #2
               └── InventoryItem #3
```

Each `InventoryItem` represents ONE physical fruit bowl.

Inventory must NOT be represented only by a numeric slot quantity.

This is required because fruit bowls have expiration information and individual lifecycle states.

---

## 6. Expiration

A ProductBatch contains:

- manufactured time
- expiration time

Expiration monitoring must eventually distinguish:

```text
fresh -> expiring soon -> expired (derived from ProductBatch.expires_at)
```

Expired inventory cannot be sold.

"Expiring soon" is a derived display/alert condition, not an InventoryStatus value.
See DATABASE.md for the actual CHECK states. Always check expires_at on reservation
and fulfillment; do not wait for a scheduled job to change AVAILABLE to EXPIRED.

Expiration monitoring and alert generation will be implemented in dedicated issues.

---

## 7. Environmental Monitoring

ESP32 reports:

- temperature
- humidity

Example telemetry:

```json
{
  "machineCode": "VM001",
  "temperature": 4.7,
  "humidity": 68.2,
  "timestamp": "..."
}
```

Sensor readings are stored historically.

The backend will later detect conditions such as:

- high temperature
- low temperature
- high humidity
- machine offline

Environmental alert rules belong to dedicated monitoring/alert features.

---

## 8. Payment

The system supports electronic payment only.

Potential providers include:

- PayOS
- MoMo
- VNPay

Payment architecture must support provider abstraction.

Important rules:

- backend verifies payment
- clients cannot mark orders as paid
- ESP32 cannot mark orders as paid
- webhook processing must be idempotent
- multiple payment attempts for one order may exist
- payment history must be preserved

---

## 9. IoT Communication

Dispense commands/results use kiosk Serial/USB with ESP32 and kiosk/backend communication.
MQTT may be used in future telemetry/status/event integrations, but is not a parallel
dispense-command path. Direct ESP32 MQTT connectivity is not required for purchase.

Conceptual topics:

```text
vending/{machineId}/telemetry
vending/{machineId}/status
vending/{machineId}/events
```

Final MQTT contracts must be documented before production implementation.

Specify whether topic identifiers are machine UUIDs or machine codes. Serial examples
above describe the approved flow, not a finalized framing/checksum/security protocol.

---

## 10. Backend Technology

Current backend stack:

- Java 21
- Spring Boot
- Maven
- PostgreSQL 18
- Spring Data JPA
- Hibernate
- Flyway
- Jakarta Validation
- Lombok
- Spring Boot Actuator
- Docker Compose for local PostgreSQL; Testcontainers for PostgreSQL integration tests
- User/Role persistence, Spring Security BCrypt and stateless JWT access-token authentication
- Initial Admin Bootstrap (issue #8): environment-driven first ADMIN, atomic and idempotent;
  existing ADMIN always wins, no public registration or User Management API yet
- OpenAPI / Swagger for development; versioned REST contract at repository-root api-contract/api.yaml

Planned integrations:

- ADMIN/STAFF endpoint authorization (authentication is implemented by issue #6; no refresh token)
- MQTT
- QR payment provider
- Application container deployment

---

## 11. Development Strategy

The backend is developed incrementally using GitHub Issues.

Current development order:

```text
Database
   ↓
Backend Foundation
   ↓
User / Role Persistence
   ↓
Authentication
   ↓
Authorization
   ↓
User Management
   ↓
Product
   ↓
Machine / Slot
   ↓
Batch / Inventory
   ↓
Sensor Monitoring
   ↓
Alerts
   ↓
Orders
   ↓
Payment
   ↓
MQTT
   ↓
Dispensing
   ↓
Reports / Dashboard
```

Each stage must be implemented through separate issues.

All schema entities were mapped earlier at the user's explicit request. Later persistence
issues must reuse these mappings and add only their missing repositories/use cases/tests.

---

## 12. Current Milestone

Current milestone:

```text
M1 - Backend Core Foundation
```

Target scope:

- Database/Flyway
- Backend common infrastructure
- User/Role persistence
- Authentication
- ADMIN/STAFF authorization
- User management
- Product management
- Machine management
- Machine slot management
- Product batch management
- Inventory management
- API documentation
- Core integration tests

IoT, payment and dispensing are later milestones.
