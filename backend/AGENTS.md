# Fruit Vending Machine Backend - AI Development Harness

## 1. Project

### Working scope and session startup

Work in the backend repository, not whichever frontend/kiosk workspace the chat opens.
Resolve the repository root with Git before acting. The Spring Boot module and this file
are under repository-root backend/; docs/ and api-contract/ are at repository root.
Do not modify apps, frontend, kiosk or firmware unless the user explicitly changes scope.
Preserve existing uncommitted work; inspect status/diff before switching branches.
For a new chat, read .ai/CURRENT_TASK.md and .ai/HANDOFF.md if present, then verify their
branch, working-tree and verification claims against local evidence before continuing.

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

### API Documentation and Swagger UI

Every issue that introduces or changes an application REST API must include matching
OpenAPI documentation and a working Swagger UI for development/testing in the same
delivery. When introducing the first business API, add the Swagger/OpenAPI integration;
do not defer it to an unspecified later issue. Choose a dependency compatible with the
current Spring Boot version and explain the addition before changing dependencies.

- Use understandable resource names, correct HTTP methods and consistent /api/v1 paths.
  Example: GET /api/v1/products/{id}, not /getProductById.
- Organize controller/DTO/service/repository code by feature. Group Swagger operations
  with clear feature tags (Auth, Users, Products, Machines, Inventory, Orders, Payments).
  Distinguish management, kiosk and provider-webhook audiences when relevant; do not
  mix unrelated operations into a single miscellaneous/default group.
- Give each operation a clear summary, purpose and stable unique operationId. Describe
  path/query parameters, request/response DTO fields, required values, formats, enum
  values, validation rules and safe realistic examples.
- Document applicable success/error HTTP statuses and the actual common response/error
  schemas. Describe pagination/filtering only when implemented; do not invent endpoints.
- Document authentication schemes and role/access requirements when applicable. Enable
  Swagger UI authorization for testing protected endpoints without weakening API security.
  Do not publish real credentials, tokens, password hashes or provider signatures in examples.
- Every application API addition/change must also create/update the version-controlled
  contract under repository-root api-contract/ in the same delivery. Swagger UI/generated
  OpenAPI does NOT replace that contract. Follow the existing contract entry point and
  file organization; do not create competing specifications for the same endpoint.
- Keep implementation, Swagger/OpenAPI and api-contract/ semantically synchronized:
  paths/methods, operationIds/tags, parameters, request/response schemas, validation,
  status/error responses, examples and authentication/access requirements must agree.
  Include relevant webhook signature/provider requirements without bypassing verification
  or trust boundaries. Do not place credentials or secrets in the contract.
- Validate the updated contract and compare it against the exposed OpenAPI document
  (automate consistency checks where practical). At handoff, list changed contract files
  and verification results so frontend developers can use the repository contract.
- At handoff, provide the actual Swagger UI and OpenAPI document URLs and local setup
  instructions. Verify both load and reflect the delivered APIs; include an appropriate
  documentation smoke test and verify a representative safe request via Swagger UI when
  possible. Disclose any UI testing limitation and leave unverified checklist items unchecked.
- Swagger Try it out is not a replacement for automated API/business-rule tests. Use
  isolated development/test data for writes, never real payments or hardware dispensing.
- Restrict or disable Swagger UI/OpenAPI in production according to the deployment policy;
  do not expose sensitive/internal endpoints or add a blanket security permitAll for APIs.

An API issue is not complete if its required Swagger UI/OpenAPI documentation or
api-contract/ contract is missing, out of date, inconsistent or unverified.
Persistence-only issues do not require inventing REST endpoints.

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

Refresh tokens are deliberately deferred. Do not add refresh-token endpoints, persistence
or rotation until the user assigns a dedicated issue for that scope.

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

Before implementing inventory/history workflows, inspect the actual applied Flyway
migrations and list their columns, constraints, indexes and triggers. Do not assume
`inventory_transactions` has quantity, batch, reason or status snapshot columns.
Document any required forward-only migration before coding; preserve historical rows.

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

Use feature/ for new features and fix/ for bug-report issues (for example,
titles prefixed with [BUG]). A bracketed prefix alone does not imply a bug;
determine the issue type from its title and scope. Create both from the latest dev.
Use the actual GitHub issue number and a lowercase kebab-case description.

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

Read .ai/GIT_WORKFLOW.md before Git delivery actions. Commit/push only when requested;
an implementation request does not automatically authorize them. The user merges into
dev manually: a commit/push request never authorizes merge, PR creation, issue closure
or GitHub checklist edits. Only a new explicit request can authorize those actions.

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

### Mandatory Regression Testing

Every software or runtime-environment change must be regression-tested so new changes
do not break previously working features. This includes bug fixes, new features,
performance optimizations, refactoring and dependency/environment upgrades.

Follow `.ai/CODING_RULES.md` section 30: test affected existing behavior and shared
flows, then run the full backend `mvn clean verify` on the final code/environment.
Include contract, schema-upgrade, startup and runtime checks when affected. Fix
regressions without weakening tests; report blocked/unverified checks honestly and
do not claim verified completion. Record commands, environment and results at handoff.
Guidance-only/documentation-only edits use content/diff verification unless they also
change software behavior or runtime configuration.

### Issue Checklist Reporting

At every issue handoff, including completion or a blocked/partial result, the final
response must reproduce ALL checklist items from the assigned issue, grouped under
their original headings (tasks, testing and acceptance criteria included). Preserve
each item's meaning; do not replace the full checklist with a summary or test count.

- Mark `[x]` only when implemented and supported by the required verification.
- Mark `[ ]` for incomplete, blocked or unverified items. For each, state what is
  missing, why, and the next step or user decision needed to resolve it.
- If an item is not applicable or satisfied by an existing implementation/approved
  alternative, explain the reason and evidence; never silently omit it.
- Include relevant code/test evidence for completed groups. Passing tests alone do
  not prove unrelated acceptance criteria are complete.
- If no items remain incomplete, explicitly say so. Separately report local testing,
  commit/push and merge status; do not imply that implementation completion means merged.
- Keep the corresponding checklist and verification status in `.ai/CURRENT_TASK.md`
  aligned with the final report. If the issue checklist cannot be retrieved, disclose
  that limitation instead of claiming exhaustive checklist completion.

Example handoff item:

```markdown
- [x] User can be found by email — repository integration test passed on PostgreSQL.
- [ ] Deployment verification — missing target environment access; user must provide it.
```

This reporting rule does NOT authorize editing GitHub issue checkboxes, closing issues,
creating PRs or merging branches. Perform those actions only when the user requests them.

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

Record newly approved persistent project rules in the relevant guidance files and keep
their examples consistent. The user's latest explicit decision supersedes earlier chat
decisions; report unresolved conflicts rather than silently choosing a different scope.
Before handing off to another chat, update .ai/HANDOFF.md with the actual branch/base,
pending changes, test evidence/limitations, Git delivery status and next authorized step.
Never include secrets or present a target workflow as already implemented functionality.

Keep the approved feature package-info.java placeholders. Shared mapped superclasses
belong in common.entity; domain entities/enums belong in their owning feature.
Do not modify apps/kiosk or firmware unless the user explicitly changes that restriction.

Never expand beyond that scope without explicit approval.
