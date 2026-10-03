You are a senior backend engineer and PostgreSQL database architect.

I am building an IoT-based Automatic Fruit Vending Machine backend.

Technology stack:
- Java 21
- Spring Boot
- Spring Data JPA / Hibernate
- PostgreSQL 18
- Flyway Migration
- Maven
- Lombok
- Spring Security + JWT later
- MQTT later for ESP32 communication

IMPORTANT:
For this task, ONLY design and implement the PostgreSQL database.
Do NOT implement controllers, services, repositories, authentication, MQTT,
payment gateway integration, or business logic yet.

==================================================
1. SYSTEM DESCRIPTION
==================================================

The system manages automatic vending machines selling prepared fruit bowls.

Each vending machine:
- Uses ESP32
- Has a touchscreen
- Has multiple physical product slots
- Has temperature and humidity sensors
- Has refrigeration
- Can dispense fruit bowls automatically
- Communicates with backend through MQTT later
- Does NOT accept cash
- Customers will pay using QR payment

There is also a Web Application for:
- ADMIN
- STAFF

The backend needs to manage:
- Users and roles
- Vending machines
- Machine slots
- Products
- Product batches
- Individual inventory items
- Expiration dates
- Temperature and humidity readings
- Alerts
- Orders
- Order items
- Payments
- Payment webhook logs
- Dispense commands
- Inventory transaction history
- Machine events
- Audit logs

==================================================
2. DATABASE DESIGN PRINCIPLES
==================================================

Use PostgreSQL 18.

Use UUID for business entity primary keys.

Use BIGSERIAL/BIGINT identity only for very high-volume append-only tables
where UUID is unnecessary, such as sensor_readings if appropriate.

Use:
- TIMESTAMPTZ instead of TIMESTAMP for business timestamps
- NUMERIC for money and sensor decimal values
- JSONB where flexible payload storage is appropriate
- proper NOT NULL constraints
- UNIQUE constraints
- CHECK constraints
- foreign keys
- indexes

Do NOT use PostgreSQL ENUM types.

Status/type fields should use VARCHAR with CHECK constraints because
application enums may evolve and database migrations should remain manageable.

Use snake_case naming.

Every important business table should have:
- created_at
- updated_at where appropriate

Do not use ON DELETE CASCADE blindly.
Choose delete behavior carefully to preserve historical transaction data.

Historical orders, payments, inventory transactions, dispense records and
audit records must not disappear if a product/user/machine is disabled.

Prefer soft status/deactivation for important business entities.

==================================================
3. TABLES
==================================================

Design the following tables.

---------------------
users
---------------------

Fields:
- id UUID PK
- email VARCHAR unique not null
- password_hash VARCHAR not null
- full_name VARCHAR not null
- phone VARCHAR nullable
- status VARCHAR not null
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

Allowed status:
ACTIVE
INACTIVE
LOCKED

---------------------
roles
---------------------

Fields:
- id UUID PK
- name VARCHAR unique not null
- description VARCHAR
- created_at TIMESTAMPTZ

Initial roles:
ADMIN
STAFF

---------------------
user_roles
---------------------

Many-to-many relationship between users and roles.

Fields:
- user_id FK
- role_id FK

Composite primary key:
(user_id, role_id)

---------------------
machines
---------------------

Fields:
- id UUID PK
- code VARCHAR unique not null
- name VARCHAR not null
- location VARCHAR
- status VARCHAR
- temperature_min NUMERIC
- temperature_max NUMERIC
- humidity_min NUMERIC
- humidity_max NUMERIC
- last_seen_at TIMESTAMPTZ
- created_at
- updated_at

Machine statuses:
ACTIVE
INACTIVE
MAINTENANCE

Add sensible CHECK constraints for environmental thresholds.

---------------------
machine_slots
---------------------

Fields:
- id UUID PK
- machine_id FK -> machines
- slot_code VARCHAR not null
- capacity INTEGER not null
- status VARCHAR not null
- created_at
- updated_at

Statuses:
ACTIVE
INACTIVE
ERROR

Constraint:
UNIQUE(machine_id, slot_code)

capacity must be > 0.

---------------------
products
---------------------

Fields:
- id UUID PK
- sku VARCHAR unique not null
- name VARCHAR not null
- description TEXT
- price NUMERIC(12,2) not null
- image_url VARCHAR
- status VARCHAR
- created_at
- updated_at

Statuses:
ACTIVE
INACTIVE

price >= 0.

---------------------
product_batches
---------------------

A batch represents multiple fruit bowls produced at the same time
with the same expiration time.

Fields:
- id UUID PK
- batch_code VARCHAR unique not null
- product_id FK -> products
- manufactured_at TIMESTAMPTZ not null
- expires_at TIMESTAMPTZ not null
- quantity INTEGER not null
- created_by FK -> users
- created_at TIMESTAMPTZ

Constraints:
- quantity > 0
- expires_at > manufactured_at

---------------------
inventory_items
---------------------

IMPORTANT:
Each row represents ONE physical fruit bowl.

Do NOT store inventory only as a quantity on machine_slots.

Fields:
- id UUID PK
- batch_id FK -> product_batches
- machine_id FK -> machines
- slot_id FK -> machine_slots
- status VARCHAR not null
- loaded_at TIMESTAMPTZ
- reserved_at TIMESTAMPTZ
- sold_at TIMESTAMPTZ
- removed_at TIMESTAMPTZ
- created_at
- updated_at

Statuses:
AVAILABLE
RESERVED
SOLD
EXPIRED
REMOVED
DISPENSE_FAILED

The design must allow querying:
- current inventory per machine
- current inventory per slot
- products expiring soon
- expired products
- available products

IMPORTANT:
machine_id and slot_id consistency cannot be completely guaranteed by a
simple FK because the slot itself belongs to a machine.

Either:
1. avoid redundant machine_id if it is unnecessary,
OR
2. implement a database constraint strategy that guarantees slot belongs
   to the same machine.

Choose the cleaner relational design and explain the decision.

---------------------
sensor_readings
---------------------

High-volume time-series table.

Fields:
- id BIGSERIAL / BIGINT identity PK
- machine_id FK -> machines
- temperature NUMERIC
- humidity NUMERIC
- recorded_at TIMESTAMPTZ not null

Create an efficient index for queries such as:

WHERE machine_id = ?
ORDER BY recorded_at DESC

Also consider indexes for time-range queries.

Do NOT add created_at if recorded_at already represents ingestion/event time
unless there is a clear reason.

---------------------
alerts
---------------------

Fields:
- id UUID PK
- machine_id FK -> machines
- type VARCHAR not null
- severity VARCHAR not null
- title VARCHAR not null
- message TEXT
- status VARCHAR not null
- triggered_at TIMESTAMPTZ
- resolved_at TIMESTAMPTZ
- resolved_by FK -> users
- created_at
- updated_at

Alert types should support:
HIGH_TEMPERATURE
LOW_TEMPERATURE
HIGH_HUMIDITY
MACHINE_OFFLINE
PRODUCT_EXPIRED
PRODUCT_EXPIRING
DISPENSE_FAILED
LOW_STOCK

Severity:
INFO
WARNING
CRITICAL

Status:
OPEN
ACKNOWLEDGED
RESOLVED

---------------------
orders
---------------------

Fields:
- id UUID PK
- order_code VARCHAR unique not null
- machine_id FK -> machines
- status VARCHAR not null
- subtotal NUMERIC(12,2)
- total_amount NUMERIC(12,2)
- created_at
- paid_at
- completed_at
- cancelled_at

Statuses:
PENDING_PAYMENT
PAID
DISPENSING
COMPLETED
CANCELLED
PAYMENT_FAILED
DISPENSE_FAILED
REFUNDED

Money values must be >= 0.

---------------------
order_items
---------------------

Fields:
- id UUID PK
- order_id FK -> orders
- product_id FK -> products
- inventory_item_id FK -> inventory_items nullable initially if needed
- quantity INTEGER
- unit_price NUMERIC(12,2)
- total_price NUMERIC(12,2)
- created_at

IMPORTANT:
unit_price must store the price at the time of purchase.
Historical orders must NOT depend on the current products.price.

Decide whether inventory_item_id belongs here or should be modeled through
a separate allocation table if an order item can have quantity > 1.
Choose the normalized design and explain it.

---------------------
payments
---------------------

Fields:
- id UUID PK
- order_id FK -> orders
- provider VARCHAR
- transaction_id VARCHAR
- payment_reference VARCHAR
- amount NUMERIC(12,2)
- status VARCHAR
- qr_code TEXT
- created_at
- paid_at
- expired_at

Providers should be extensible, examples:
PAYOS
MOMO
VNPAY

Payment statuses:
PENDING
SUCCESS
FAILED
EXPIRED
REFUNDED

Do not assume exactly one payment attempt per order unless justified.
Design for payment retries safely.

Add uniqueness only where it is actually safe, especially transaction IDs.

---------------------
payment_webhook_logs
---------------------

Fields:
- id UUID PK
- provider VARCHAR
- event_type VARCHAR
- order_code VARCHAR
- raw_payload JSONB or TEXT
- signature VARCHAR
- is_verified BOOLEAN
- received_at TIMESTAMPTZ

This table is used for debugging and payment auditing.

Prefer JSONB for valid JSON payloads.

---------------------
dispense_commands
---------------------

Fields:
- id UUID PK
- command_code VARCHAR unique not null
- order_id FK
- machine_id FK
- slot_id FK
- inventory_item_id FK
- status VARCHAR
- sent_at
- acknowledged_at
- completed_at
- created_at
- updated_at

Statuses:
PENDING
SENT
ACKNOWLEDGED
SUCCESS
FAILED
TIMEOUT

Prevent duplicate successful dispensing of the same inventory item
where practical.

---------------------
inventory_transactions
---------------------

Immutable history of inventory changes.

Fields:
- id UUID PK
- inventory_item_id FK
- machine_id FK
- slot_id FK
- type VARCHAR
- reference_id UUID nullable
- performed_by FK -> users nullable
- created_at

Types:
LOAD
RESERVE
SALE
EXPIRE
REMOVE
RETURN
ADJUSTMENT

Treat this table as append-only history.

---------------------
machine_events
---------------------

Fields:
- id UUID PK
- machine_id FK
- event_type VARCHAR
- payload JSONB
- created_at TIMESTAMPTZ

Examples:
BOOT
CONNECTED
DISCONNECTED
DOOR_OPENED
DOOR_CLOSED
MOTOR_ERROR
SENSOR_ERROR
REFRIGERATION_ERROR

---------------------
audit_logs
---------------------

Fields:
- id UUID PK
- user_id FK -> users nullable
- action VARCHAR
- entity_type VARCHAR
- entity_id UUID
- old_value JSONB
- new_value JSONB
- ip_address VARCHAR
- created_at TIMESTAMPTZ

Audit logs should preserve history even if the referenced business entity
is later disabled.

==================================================
4. IMPORTANT BUSINESS RULES
==================================================

The schema must support these rules:

1. Expired inventory cannot be sold.

2. Each inventory_item represents exactly one physical fruit bowl.

3. A fruit bowl belongs to one product batch.

4. A product batch belongs to one product.

5. Inventory can be loaded into machine slots.

6. One slot belongs to exactly one machine.

7. Historical order prices must never change when product prices change.

8. Successful payment must be traceable to an order.

9. Multiple payment attempts for the same order must be possible.

10. Dispense commands must be idempotent enough to prevent accidental
double dispensing.

11. Sensor data will grow quickly and indexes must support:
    latest reading per machine
    readings within a time range

12. Inventory history must be auditable.

13. Products, machines and users should normally be disabled rather than
physically deleted when historical records reference them.

14. Database schema should prevent invalid data where PostgreSQL constraints
can reasonably enforce it.

15. Do NOT implement business rules using complicated triggers unless
there is a strong reason.
Prefer application service logic for workflow/state transitions.

==================================================
5. INDEXES
==================================================

Analyze the expected query patterns and create appropriate indexes.

At minimum consider indexes for:

sensor_readings:
(machine_id, recorded_at DESC)

inventory_items:
slot_id + status
batch_id
status

product_batches:
product_id
expires_at

orders:
machine_id
status
created_at

payments:
order_id
status
transaction_id

alerts:
machine_id
status
triggered_at

dispense_commands:
machine_id
order_id
status

inventory_transactions:
inventory_item_id
created_at

machine_events:
machine_id
created_at

Do NOT create redundant indexes when PostgreSQL already creates one
for PRIMARY KEY or UNIQUE constraints.

==================================================
6. FLYWAY
==================================================

Use Flyway.

Generate migrations in:

src/main/resources/db/migration/

Prefer multiple logical migration files instead of one giant file.

For example:

V1__create_user_and_role_tables.sql
V2__create_machine_tables.sql
V3__create_product_and_inventory_tables.sql
V4__create_sensor_and_alert_tables.sql
V5__create_order_and_payment_tables.sql
V6__create_dispense_and_event_tables.sql
V7__create_indexes.sql
V8__seed_roles.sql

You may adjust this migration split if dependency ordering requires it.

All migrations must run successfully on a completely empty PostgreSQL 18
database.

Do not modify an existing migration after it has been applied.
Future changes should create a new migration.

==================================================
7. OUTPUT REQUIRED
==================================================

Before generating files:

STEP 1:
Analyze the schema and point out:
- normalization problems
- redundant columns
- missing relationships
- dangerous cascade deletes
- missing uniqueness constraints
- important indexes
- business rules that should stay in Spring Boot rather than PostgreSQL

STEP 2:
Show the final ERD in Mermaid erDiagram format.

STEP 3:
Show the final table list and relationships.

STEP 4:
Generate all Flyway SQL migration files.

STEP 5:
For every table explain briefly:
- purpose
- primary key
- important foreign keys
- important constraints
- important indexes

STEP 6:
Provide commands/queries to verify the database after Flyway runs.

Examples:

SELECT * FROM flyway_schema_history;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

STEP 7:
Provide a small set of DEVELOPMENT-ONLY seed data:
- ADMIN role
- STAFF role
- one machine
- several slots
- two products

Do NOT insert plaintext passwords.

==================================================
8. QUALITY REQUIREMENTS
==================================================

Do not blindly follow my proposed schema if there is a relational design
problem.

If you identify a problem, explain it and improve the design before writing SQL.

The final database must be suitable for a real Spring Boot backend,
not just a classroom CRUD demo.

Prioritize:
1. Data integrity
2. Traceability
3. Maintainability
4. Correct relationships
5. Query performance
6. Simplicity

Do not over-engineer.

Do not implement Spring Boot code yet.

At the end, summarize any decisions that the future Spring Boot/JPA layer
must respect.