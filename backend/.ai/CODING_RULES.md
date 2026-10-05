# Backend Coding Rules

These rules are mandatory for developers and AI coding agents.

---

## 1. Priorities

Prioritize:

1. Correctness
2. Data integrity
3. Readability
4. Maintainability
5. Security
6. Testability
7. Simplicity

Do not over-engineer.

Follow existing conventions before introducing new patterns.

---

## 2. Java

Use Java 21.

Use clear, descriptive names.

Java naming:

```text
ClassName
methodName
variableName
CONSTANT_NAME
```

Avoid unclear abbreviations.

---

## 3. Package Organization

Use feature-based packages.

Example:

```text
user/
├── controller/
├── dto/
├── entity/
├── repository/
└── service/
```

Do not move all controllers/services/repositories into global layer packages.

Keep the approved feature placeholders (`package-info.java`) from the foundation.
They document boundaries; they do not authorize implementation of future issues.
Do not create unused controllers/services/repositories merely to fill those packages.

---

## 4. Dependency Injection

Use constructor injection.

Preferred:

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
}
```

Avoid field injection:

```java
@Autowired
private ProductRepository productRepository;
```

---

## 5. Controllers

Controllers should:

- receive requests
- validate input
- call services
- return responses

Controllers must not:

- call repositories directly
- contain complex business logic
- implement transactions
- contain SQL/query logic

---

## 6. Services

Services contain:

- business rules
- state transitions
- transaction boundaries
- coordination between repositories/integrations

Use:

```java
@Transactional
```

only where a real transaction boundary exists.

For read-only operations, use when appropriate:

```java
@Transactional(readOnly = true)
```

Do not keep a database transaction open while waiting for external services or MQTT responses.

---

## 7. Repositories

Use Spring Data JPA repositories.

Example:

```java
public interface UserRepository
        extends JpaRepository<User, UUID> {
}
```

Use derived queries for simple operations.

Example:

```java
Optional<User> findByEmail(String email);
boolean existsByEmail(String email);
```

Use JPQL/native SQL only when necessary.

Repositories must not implement business workflows.

---

## 8. JPA Entities

Use explicit entity/table mappings.

Example:

```java
@Entity
@Table(name = "users")
public class User {
}
```

Entity mappings must match Flyway.

Do not expose entities directly from REST controllers.

Do not use Lombok `@Data` blindly on entities.

Prefer:

```java
@Getter
@Setter
@NoArgsConstructor
```

Use builders/constructors deliberately.

Do not include lazy/bidirectional relationships blindly in:

```text
toString()
equals()
hashCode()
```

Avoid recursive entity serialization.

---

## 9. Relationships

Do not use:

```java
CascadeType.ALL
```

without explicit lifecycle justification.

Shared entities such as `Role` must not be accidentally deleted through another entity.

Choose fetch strategy deliberately.

Do not use `EAGER` everywhere.

Use explicit fetch queries/entity graphs when a use case requires relationships.

Avoid N+1 queries.

---

## 10. IDs

Business entity IDs use UUID when defined by the database.

Use the generation strategy established by the schema/project.

Do not change primary key types without a migration/design decision.

High-volume technical tables may use BIGINT according to Flyway.

---

## 11. Date and Time

For PostgreSQL:

```text
TIMESTAMPTZ
```

use:

```java
Instant
```

Use Instant for persisted absolute event/audit/payment/expiration timestamps and UTC
ISO-8601 API timestamps. PostgreSQL TIMESTAMPTZ preserves an instant, not the original
offset or region. Keep JDBC/JVM configuration in UTC and round database-bound values
to microsecond precision where deterministic round trips are required.

Use OffsetDateTime at an integration boundary when an external contract requires an
offset, then normalize to Instant for persistence. Use ZoneId/ZonedDateTime for local
display or future region-based scheduling. Preserving an original zone requires an
explicit model/schema decision; changing Java types does not preserve it in TIMESTAMPTZ.

See [PostgreSQL date/time storage](https://www.postgresql.org/docs/18/datatype-datetime.html).

Avoid `java.util.Date`.

Avoid `LocalDateTime` for absolute timestamps backed by TIMESTAMPTZ.

For time-sensitive business logic that requires deterministic tests, consider injecting:

```java
Clock
```

instead of scattering direct system time calls.

---

## 12. Money

Use:

```java
BigDecimal
```

for money.

Never use:

```java
float
double
```

for prices/payment amounts.

Use explicit rounding rules when rounding is necessary.

Do not compare BigDecimal using `==`.

---

## 13. Enums

Persist application enums using:

```java
@Enumerated(EnumType.STRING)
```

Never use:

```java
EnumType.ORDINAL
```

Java enum values must match database CHECK values.

Do not introduce PostgreSQL ENUM without an explicit architecture/database decision.

---

## 14. DTOs

Use DTOs at API boundaries.

Examples:

```text
CreateProductRequest
UpdateProductRequest
ProductResponse
```

Simple immutable DTOs may use Java records.

Example:

```java
public record CreateProductRequest(
    @NotBlank String sku,
    @NotBlank String name,
    @Positive BigDecimal price
) {}
```

Do not add JPA annotations to DTOs.

---

## 15. Validation

Use Jakarta Validation.

Examples:

```java
@NotNull
@NotBlank
@Email
@Positive
@PositiveOrZero
@Size
```

Frontend validation is not sufficient.

Database constraints remain the final protection for critical integrity rules such as uniqueness and foreign keys.

---

## 16. API Paths

Base API path:

```text
/api/v1
```

Prefer REST resource naming.

Good:

```text
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/{id}
PUT    /api/v1/products/{id}
```

Avoid:

```text
/getProducts
/createProduct
/deleteProductById
```

unless an action cannot reasonably be represented as a resource operation.

---

## 17. HTTP Status Codes

Use appropriate status codes.

```text
200 OK
201 Created
204 No Content

400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict

500 Internal Server Error
```

Do not return `200 OK` for all outcomes.

---

## 18. Error Handling

Use centralized exception handling with:

```java
@RestControllerAdvice
```

Use project exceptions such as:

```text
ResourceNotFoundException
BadRequestException
ConflictException
```

Do not expose:

- stack traces
- SQL errors
- credentials
- secrets
- internal implementation details

to API clients.

---

## 19. API Responses

Use the common response/error conventions established by the project.

Do not create a different response wrapper for every feature.

Do not over-engineer response wrappers.

---

## 20. Null and Optional

Use `Optional<T>` primarily for return values where absence is expected.

Example:

```java
Optional<User> findByEmail(String email);
```

Avoid Optional as:

- JPA entity fields
- DTO fields
- method parameters

unless there is a specific justified use case.

---

## 21. Logging

Use SLF4J.

Do not use:

```java
System.out.println()
```

for application logging.

Use appropriate levels:

```text
DEBUG
INFO
WARN
ERROR
```

Never log:

- plaintext passwords
- password hashes
- JWT secrets
- access tokens
- database passwords
- payment secrets
- MQTT passwords
- private keys

Avoid logging sensitive payment payloads unnecessarily.

---

## 22. Secrets

Never hardcode credentials.

Use configuration/environment variables.

Examples:

```text
DB_USER
DB_PASSWORD
JWT_SECRET
MQTT_USERNAME
MQTT_PASSWORD
PAYMENT_API_KEY
```

Real `.env` files and secret local configuration must not be committed.

Provide `.env.example` where useful.

Use the existing local `.env` mechanism for database and application connection settings;
do not require repeated manual credential entry or introduce competing configuration.
Document which launcher loads `.env`; do not assume every IDE, JVM or database client
automatically reads it. Keep `.env.example` synchronized using placeholders only.
Never print real `.env` contents or copy credentials into guidance/API documentation.

---

## 23. Passwords

Never store plaintext passwords.

Password hashing will use the project security configuration.

Do not invent custom password encryption/hashing algorithms.

---

## 24. Payment Safety

Never trust payment success received from:

- browser
- touchscreen
- ESP32

Only verified backend/provider processing may transition payment/order state accordingly.

Payment webhook handlers must be designed for duplicate delivery.

Backend creates/authorizes a persisted dispense command after payment verification.
Kiosk relays that command over Serial/USB to ESP32 and reports the correlated result.
Receiving PAID is not permission for kiosk to invent a command or change its slot.
Validate kiosk identity, machine ownership and command state; duplicate success must
not sell inventory twice. Unknown/time-out results require reconciliation, not blind retry.

---

## 25. MQTT Safety

Validate MQTT payloads.

Do not put full business workflows inside MQTT callbacks.

MQTT listeners should delegate to services.

Duplicate/malformed MQTT messages must not corrupt application state.

---

## 26. Inventory Safety

Do not bypass inventory state rules.

Each InventoryItem represents one physical bowl.

Expired inventory must not be reserved or sold.

Inventory state changes must preserve required history.

---

## 27. State Transitions

Do not allow arbitrary status changes.

Example:

An Order should not be able to move directly from:

```text
COMPLETED
```

back to:

```text
PENDING_PAYMENT
```

without an explicitly designed workflow.

State transition rules belong in services.

---

## 28. Comments

Comments should explain WHY, not repeat WHAT the code does.

Bad:

```java
// Find user
User user = repository.findById(id);
```

Useful comments describe:

- non-obvious business rules
- technical constraints
- interoperability requirements
- workarounds

Prefer readable code over excessive comments.

---

## 29. Method Design

Keep methods focused.

Avoid giant methods/services.

Extract logic when doing so improves:

- readability
- reuse
- testability

Do not create unnecessary abstractions merely to reduce line count.

---

## 30. Testing

Use appropriate testing tools:

- JUnit 5
- Spring Boot Test
- Spring Data JPA Test
- Mockito

Tests should cover:

- happy path
- validation
- important failures
- important business rules

Test behavior, not implementation details.

Do not disable failing tests merely to make CI pass.

---

## 31. PostgreSQL Testing

Do not assume H2 behaves identically to PostgreSQL.

PostgreSQL-specific behavior should be tested against a compatible PostgreSQL environment when required.

Database tests should verify important constraints when relevant:

```text
UNIQUE
FOREIGN KEY
CHECK
```

---

## 32. Flyway

Never edit an already-applied migration.

Never solve entity validation problems by changing historical migrations.

Create a new migration for genuine schema changes.

Run migration validation after database changes.

---

## 33. Hibernate

Hibernate must use:

```text
ddl-auto=validate
```

Do not switch to `update` to make an entity work.

Schema mismatch means the mapping/schema must be investigated.

---

## 34. AI-Specific Rules

AI agents must not:

- expand issue scope
- implement future issues
- modify unrelated files
- silently change architecture
- silently change database design
- add dependencies without justification
- disable security controls
- weaken tests
- replace working implementations unnecessarily
- modify applied Flyway migrations

AI agents must inspect existing implementation before generating replacements.

---

## 35. Definition of Code Complete

Before declaring work complete:

- [ ] Code compiles
- [ ] Relevant tests pass
- [ ] Acceptance criteria pass
- [ ] Flyway validation passes when relevant
- [ ] Hibernate validation passes when relevant
- [ ] No applied migrations were changed
- [ ] No unrelated files were modified
- [ ] No secrets were committed
- [ ] Important errors are handled
- [ ] Changed code follows project architecture
