# Issue #24 — Core Backend Integration Tests

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/24
Branch: feature/24-core-backend-integration-tests
Base: fe68a47f716ea5f82a3fb88ea16bcd04d3018fcb
Latest fetched dev includes #22 via PR#25; 8e9aac6 ancestor verified, initial tree clean.
Implementation, commit/push, remote CI verification and temporary probe branch cleanup
authorized by user. No PR/merge/GitHub issue edits authorized.

## Scope and audit

Reuse 431 existing tests and real PostgreSQL18/Testcontainers/Flyway/Hibernate/JWT/security.
Inspected V3/V6/V9: per-item history, nullable V9 snapshots, append-only trigger SQLSTATE55000,
RESTRICT item/history FK, no schema defect identified. No migration/API/business change needed.
Add shared TestPostgres factory, reusable core base/profile/HTTP fixture factory, complete
cross-domain tests, real PostgreSQL fault rollback, observed overlapping transaction races,
constraint/Flyway tests and backend GitHub Actions. Reuse current Surefire *Test naming.
No new dependency or future workflow; no .env/developer database changes.
Per-class disposable containers; per-test unique fixtures preserve append-only history;
no outer test transaction masking real commits/rollback. Fault-injection triggers scoped to
unique batches are removed in finally; no production trigger disabled.
CI workflow verifies Docker, Java21, full Maven lifecycle and always uploads reports.

## Verification — final local results, 2026-10-10

- mvn --batch-mode --no-transfer-progress clean verify: 442 tests, zero failures/errors/
  skips, BUILD SUCCESS. Includes all previous431 feature/auth/security/schema/docs tests
  plus11 new core tests; real PostgreSQL18, Java21.0.10, Maven3.9.12.
- Targeted four new classes:11 pass. Repeat with random Surefire class order and JUnit
  method order:11 pass. Individual batch-race method:1 pass. No order dependency observed.
- Concurrency observes both independent transactions waiting in pg_stat_activity before
  release; exact capacity6/occupied4 and batch20/registered18 scenarios end6/end20.
- SQL-fault trigger rejects second history insert with23514/XX000:409/500 sanitized,
  zero partial items/events, recovery load commits after fault removed. No mock repository.
- Flyway validate/migrate-again, 9 migrations/20 total tables and actual JDBC metadata
  confirm isolated Testcontainers database. SQL unique/FK/CHECK/RESTRICT/append-only
  guards verified. All19 entities and startup HTTP checks pass existing EntityMappingTest.
- TestPostgres factory reused by20 existing suites. After-class context cleanup added to
 17 existing Spring database suites; their original assertions/bodies compared with HEAD
  and unchanged. New base uses the same cleanup. Testcontainers snapshots before/after
  full verify empty; after random/individual runs also no leftover containers.
- actionlint1.7.12 PASS for GitHub Actions syntax/semantics. Verified official Actions SHAs
  pinned. Workflow Java21/Ubuntu24.04/Docker/Maven full suite, always-upload Surefire reports,
  no skip/continue-on-error/production credentials. Initial failing targeted test returned
  Maven exit1, verifying local failure propagation; remote evidence also verified below.
- No production source/API/contract/pom change. All9 applied migrations byte-equivalent
  after newline normalization. No .env/developer DB or hardware/external service access.
- git diff --check pass. Exact62 original checklist items/text/order checked against live
  issue;62 verified, none unchecked after remote CI verification. No GitHub issue edits.
- GitHub Actions success run38043959910 on f079480:442tests,0failure/error/skip,
  BUILD SUCCESS, successful job and backend-test-reports artifact11667480945.
- Temporary failure run38043998076 on ff107f4:443tests, exactly1failure in
  CiFailurePropagationProbeTest,0error/skip, Maven exit1, build step/job/run failure.
  Artifact11666676394 uploaded successfully despite failure. Both ZIPs/XML and logs
  downloaded and parsed; existing442tests also pass in the failing run.
- Temporary feature/24-ci-failure-probe-f079480 branch SHA checked unchanged and removed
  locally/remotely. Intentional failing test never entered delivery branch. Runs/artifacts
  retained as evidence; no PR/merge/GitHub issue checkbox edits.
- Branch feature/24-core-backend-integration-tests, basefe68a47. Implementation commit
  f0794800542657ab54896013781ecd028466ef25 pushed and verified by GitHub CI.
  This docs-only follow-up snapshot records final evidence; resolve current HEAD via Git.
- All62 original checklist items verified; no incomplete item remains.

Evidence under backend/target/ (ignored): issue24-verify.log, issue24-targeted-fixed.log,
issue24-repeat-random.log, issue24-individual.log, issue24-actionlint.log,
issue24-containers-before.log, issue24-containers-after-verify.log,
issue24-containers-after-final.log, surefire-reports/. Targeted reruns can overwrite their
own Surefire reports; full-suite totals are retained in issue24-verify.log.
Coverage/setup: ../../docs/core-integration-testing.md. New tests: integration/ four classes;
shared support/ four classes and src/test/resources/application-test.yml.
CI workflow: ../../.github/workflows/backend-tests.yml.

# 28. Testing Checklist

## Environment

- [x] PostgreSQL Testcontainer starts successfully.
- [x] Spring Boot test context loads.
- [x] Flyway migrations run successfully.
- [x] Hibernate schema validation passes.
- [x] Test database is isolated.
- [x] Test data cleanup works.

## Authentication

- [x] Valid login succeeds.
- [x] Invalid credentials fail.
- [x] Inactive users cannot authenticate.
- [x] Locked users cannot authenticate.
- [x] Missing JWT returns 401.
- [x] Invalid JWT returns 401.
- [x] Expired JWT returns 401.

## Authorization

- [x] ADMIN permissions work.
- [x] STAFF permissions work.
- [x] ADMIN-only endpoints reject STAFF.
- [x] Unauthenticated requests are rejected.
- [x] Authorization rules match existing business requirements.

## Core Management

- [x] User Management integration tests pass.
- [x] Product Management integration tests pass.
- [x] Machine Management integration tests pass.
- [x] Machine Slot integration tests pass.
- [x] Product Batch integration tests pass.
- [x] Inventory integration tests pass.

## Database

- [x] Unique constraints are enforced.
- [x] Foreign keys are enforced.
- [x] CHECK constraints are enforced.
- [x] Transactions roll back correctly.
- [x] No partial inventory loading occurs.

## Concurrency

- [x] Concurrent loading cannot exceed slot capacity.
- [x] Concurrent loading cannot exceed batch quantity.
- [x] Tests use real PostgreSQL transactions.
- [x] Tests are repeatable.

## CI

- [x] Tests run through Maven.
- [x] Tests run in GitHub Actions.
- [x] Test failures fail the pipeline.
- [x] Test reports are generated.
- [x] No external production services are required.

---

# 30. Acceptance Criteria

The issue is complete when:

- [x] Core integration test infrastructure is implemented.
- [x] PostgreSQL Testcontainers is configured.
- [x] Integration tests use real PostgreSQL.
- [x] Flyway migrations execute in tests.
- [x] Hibernate schema validation passes.
- [x] Authentication integration tests are implemented.
- [x] ADMIN/STAFF authorization tests are implemented.
- [x] User Management integration tests are implemented.
- [x] Product Management integration tests are implemented.
- [x] Machine Management integration tests are implemented.
- [x] Machine Slot integration tests are implemented.
- [x] Product Batch integration tests are implemented.
- [x] Inventory Management integration tests are implemented.
- [x] Database constraints are verified.
- [x] Inventory transaction rollback is verified.
- [x] Inventory concurrency behavior is verified.
- [x] Test data is isolated and repeatable.
- [x] Tests do not depend on execution order.
- [x] Integration tests can run through Maven.
- [x] Integration tests run in GitHub Actions.
- [x] Failed tests cause CI failure.
- [x] No production database or external hardware is required.
- [x] No unrelated business features are introduced.
- [x] Existing Flyway migrations remain unchanged.

---

## Remote CI evidence

Successful full suite: https://github.com/hoaifpt/Fruit_Vending_Machine/actions/runs/38043959910
Intentional failing probe: https://github.com/hoaifpt/Fruit_Vending_Machine/actions/runs/38043998076

Ignored evidence: issue24-ci-evidence.json, issue24-ci-success-reports.zip,
issue24-ci-success-logs.zip, issue24-ci-failure-probe-reports.zip and
issue24-ci-failure-probe-logs.zip under backend/target/. No production credentials.
