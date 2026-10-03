# JWT authentication — issue #6

## Scope

Management login only: `POST /api/v1/auth/login`. No refresh token, registration,
user CRUD or ADMIN/STAFF endpoint policy. Expired access tokens require logging in again.
Accounts already exist in PostgreSQL and must use BCrypt hashes from Spring's
`BCryptPasswordEncoder`. Historical arbitrary test hashes are not usable credentials.
Flyway seeds ADMIN/STAFF roles only; no account, password or new schema is introduced.
User provisioning belongs to the future User Management issue; do not add a default admin.

## Local configuration and startup

Copy `.env.example` to repository-root `.env` if you do not already have one.
Preserve existing DB settings and add:

```properties
JWT_SECRET=<Base64-encoded-random-key>
JWT_EXPIRATION_SECONDS=3600
API_DOCS_ENABLED=true
```

Generate a key locally with PowerShell, then copy its output into your ignored `.env`:

```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Never share this output, commit it, use a human password as the signing key, or use a
production key locally. The application does not generate/fall back to a default key.
Missing/invalid Base64, fewer than 32 decoded bytes, or expiry outside 1–86400 seconds
fails startup without echoing the configured value. Real environment variables override
`.env`; `.env` is imported from root when running Maven from the backend module.

Start the project's local PostgreSQL using its existing Docker Compose instructions,
then from `backend/` run:

```powershell
mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
```

With default SERVER_PORT=8080:

- Swagger UI: http://localhost:8080/swagger-ui/index.html
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- OpenAPI YAML: http://localhost:8080/v3/api-docs.yaml
- Health: http://localhost:8080/actuator/health

Set `SPRING_PROFILES_ACTIVE=prod` for production: `application-prod.yaml` disables
Swagger/OpenAPI even if the local API_DOCS_ENABLED flag is present. Deploy behind HTTPS;
never deliberately override the production documentation disablement.

## Frontend contract and usage

Version-controlled specification: `api-contract/api.yaml` at repository root. Generated
Swagger is not a replacement. Request/response examples use placeholders, not credentials.
Integration tests parse YAML, resolve local references and compare methods, paths,
operationId/tag/summary, request body, response/status/header/example definitions,
schema fields/types/formats/required/validation/enum/refs and security schemes to OpenAPI.

Login sends JSON with required nonblank valid email (max 254 characters) and nonblank
password (max 72 characters AND 72 UTF-8 bytes, due to BCrypt). Email is normalized to
lowercase; password is never modified. Remove any Authorization header when logging in.

Success `200` uses common `ApiResponse`: timestamp, message and data containing
accessToken, tokenType=`Bearer`, expiresIn in seconds. Response has `Cache-Control: no-store`
and `Pragma: no-cache`; do not log the token or put it into a URL. Protect client-side token
handling from XSS; production browser storage/refresh strategy belongs to a later issue.

For authenticated API requests send `Authorization: Bearer YOUR_ACCESS_TOKEN`.
Swagger Authorize accepts only the token value (omit `Bearer`); it does not persist
authorization between browser sessions. Currently login is the only shipped application
endpoint; no unrelated protected business endpoint is invented for demonstration.

Error responses follow common ApiErrorResponse (timestamp/status/error/message/path;
fieldErrors only when nonempty). No rejected password value, hash, JWT or internal details.

- `400`: invalid fields/JSON, missing body, or >72 UTF-8 password bytes.
- `401`: generic `Invalid email or password` for unknown email/wrong password/INACTIVE/LOCKED.
  Missing/invalid Bearer authentication uses `Authentication required or access token invalid`.
  A present invalid header is rejected even on public login/health/docs; remove it first.
  Security 401 responses include `WWW-Authenticate: Bearer` and no-store.
- `403`: common `Access denied` baseline; detailed RBAC is not implemented in this issue.
- `500`: generic unexpected error, never internal/security details.

## Token and security design

HS256 JOSE/Nimbus via Spring Security's Boot-managed `spring-security-oauth2-jose`.
No handwritten JWT signing/parsing or second JWT library. JWT payload is readable, not
encrypted: only sub=UUID, email, roles (`ROLE_` names), iat and exp. Key rotation invalidates
existing tokens; there is no revocation table, logout blacklist or refresh endpoint.

Only the configured HS256 algorithm is accepted; signature and required UUID subject,
issued-at and expiration are checked before DB access. Expiry is strict, no implicit
leeway; future iat/nbf and absent/invalid claims are rejected. Clock is injected.

Every valid token request reloads the user and roles via an explicit UUID graph query.
Deleted/INACTIVE/LOCKED accounts cannot reuse a token; role changes take effect immediately.
JWT role/email snapshots are not trusted as current authorities/identity. Principal credentials
are erased. Authentication establishes a fresh SecurityContext, no sessions/cookies, form
login, Basic auth, request cache or logout filter. CSRF is disabled for header-only credentials;
reassess CSRF if cookie authentication is introduced later. No cross-origin CORS policy is
invented without the frontend's actual origins.

Only POST login and GET health are public (plus opt-in documentation GETs). Other application
requests require authentication; no hasRole/PreAuthorize policies yet. JWT filter is registered
once inside the security chain, not additionally as a servlet filter. Error dispatch remains
available so actual MVC failures retain their intended common status.

## Verification

From module: `mvn clean verify` with Java 21 and Docker. Tests use isolated PostgreSQL 18,
random ephemeral signing keys and unchanged V1–V8 migrations with Hibernate validate.
Test-only authenticated endpoints are under src/test and hidden from generated OpenAPI.
Time-dependent tests use fixed clocks, not sleeps. Existing response-handler tests disable
filters because they test MVC error mapping only; real security-chain tests run separately
with filters enabled. Legacy unavailable Actuator probes now correctly expect 401 before MVC.

Browser smoke verification uses an isolated temporary PostgreSQL and localhost:8081, not
the user's database: Swagger loads Auth/login, Try it out returns the documented generic
401 for dummy credentials, and Authorize exposes the Bearer scheme. Production docs test
verifies unauthenticated 401 and authenticated 404 for all disabled docs routes.
