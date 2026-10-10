# Chat handoff — Issue #24, 2026-10-10

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/24, [BE] Add core backend integration tests.
Branch feature/24-core-backend-integration-tests, basefe68a47f716ea5f82a3fb88ea16bcd04d3018fcb.
Implementation f0794800542657ab54896013781ecd028466ef25 committed/pushed;
this documentation snapshot records completed CI evidence. Resolve HEAD/upstream via Git.
Fetched dev merged#22 viaPR#25; 8e9aac6 ancestor verified; initial tree clean.
#22 committed/pushed8e9aac6 and merged by user. User explicitly authorized #24 commit/
push, successful CI verification, temporary intentionally failing test branch and cleanup,
and local checklist/handoff updates. No PR/merge/GitHub issue edits authorized/performed.

Implementation/local/remote verification complete: all62source checklist items checked.
Successful run442tests, probe run443tests/exactly1intentional failure; artifacts parsed.
Temporary branch removed locally/remotely after SHA check. No probe on delivery branch.

Scope:
- support/TestPostgres factory reused by20 existing database suites; no test bodies or
  assertions weakened.17 existing Spring database contexts close after class.
- AbstractCoreIntegrationTest: profile test/MockMvc, real per-class disposable DB,
  random JWT key and synthetic ADMIN; .env config imports disabled at test annotation.
- TestDataFactory: unique root domain/STAFF fixtures through existing controllers/login.
-4 new classes: CoreManagementFlowIntegrationTest, CoreDatabaseIntegrationTest,
  InventoryDatabaseRollbackIntegrationTest, InventoryConcurrentRequestsIntegrationTest.
- Real SQL trigger faults after first history insert verify409/500 sanitized rollback,
  zero partial records and successful recovery. Fault removed in finally; no mocks/outer
  test transaction/production trigger bypass.
- Race examples exact6/4 and20/18 initial states, overlapping requests observed in
  pg_stat_activity before releasing lock; exactly one201/one409 and correct final state.
- Per-method unique fixtures preserve append-only history; class disposal handles cleanup.
- Existing431tests retained, no new dependencies/API/business feature/schema change.
  V3/V6/V9 actual schema audited, all V1–V9 remain unchanged.
- .github/workflows/backend-tests.yml: PRdev/main, pushdev/main/feature/**/fix/**,
  manual dispatch, Ubuntu24.04/Java21/Docker, Maven clean verify, always upload reports,
  contents:read token, SHA-pinned official Actions. No skip/continue-on-error/secrets.
- Docs core-integration-testing.md, root/workflows README, .ai architecture/project updated.

Verification:
- mvn --batch-mode --no-transfer-progress clean verify BUILD SUCCESS:442tests,0failure/error/skip.
- Targeted new core classes11pass; random class/method order repeat11pass; individual
  batch-race method1pass. Java21.0.10/Maven3.9.12/PostgreSQL18.6 Docker.
- actionlint1.7.12 PASS. Initial targeted-run test assumption failures returned
  Maven exit1; datasource metadata/RESTRICT SQLSTATE assertions corrected without
  production changes. Actual remote job behavior now verified, see evidence below.
- Factory/context cleanup are the only edits to existing tests, audited against HEAD.
- Flyway/Hibernate/entity/startup/feature/docs contracts/security regression all pass.
- Container snapshots before/after full verify empty, and after repeat/individual empty;
  no .env/developer DB/hardware changed. git diff --check pass.
- Exact62 source checklist texts/order match live GitHub issue. CURRENT_TASK62x/0unchecked.
- Success run38043959910:442tests,0failure/error/skip, build/job/run success,
  backend-test-reports artifact11667480945. Probe run38043998076:443tests,1intentional
  CiFailurePropagationProbeTest failure,0error/skip, Maven exit1 and build/job/run failure;
  reports artifact11666676394 still uploaded successfully. Downloaded XML/logs confirm
  all existing442tests pass on both runs. No GitHub issue checklist edits.

Ignored evidence under backend/target/: issue24-verify.log, issue24-targeted-fixed.log,
issue24-repeat-random.log, issue24-individual.log, issue24-actionlint.log, container
snapshots and surefire-reports/. Reruns overwrite their own reports; full442total in log.

Remote evidence:
https://github.com/hoaifpt/Fruit_Vending_Machine/actions/runs/38043959910
https://github.com/hoaifpt/Fruit_Vending_Machine/actions/runs/38043998076
Ignored backend/target/issue24-ci-evidence.json and success/failure ZIP reports/logs.

Next: await user manual merge/new instruction after current Git delivery. Do not create
PR/merge/edit issue checkboxes without explicit authorization. No production data touched.
Existing Swagger/API contract unchanged and regression verified. Local Swagger8080/
swagger-ui/index.html, OpenAPI8080/v3/api-docs when enabled. No new UI QA required by24.
