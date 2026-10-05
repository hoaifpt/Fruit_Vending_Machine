# Chat handoff — 2026-10-05

This is a local snapshot, not authorization to implement a new issue or deliver Git changes.
Read AGENTS.md and the .ai guidance; verify Git status and test evidence before acting.

## Workspace and current work

- Repository: C:/Users/north/Documents/School/9/FruitMachine/backend.
- Spring Boot module: repository-root backend/ (Java 21, Maven).
- Current branch: feature/10-admin-staff-authorization.
- Base/local HEAD: 1706bd2, merged issue #8 through PR #11.
- Issue #10 scope, original checklist and verification: CURRENT_TASK.md.
- Issue #10 implementation is complete locally but remains uncommitted/unpushed.
  The user reports normal operation; this does not independently verify every criterion.
- Pending changes include method-security configuration, authorization tests, OpenAPI/
  API-contract metadata, documentation and this guidance maintenance. Preserve them.

## Verification and implemented boundaries

- Recorded final issue #10 run: mvn clean verify, 123 tests, zero failures/errors/skips,
  PostgreSQL 18 Testcontainers; Flyway V1–V8 and Hibernate validate. Reports are under
  backend/target/surefire-reports/ and may become stale after later code edits.
- No test suite rerun for this documentation-only maintenance; diff whitespace checked.
- Backend has migrations/JPA, common foundation, User/Role persistence, JWT login,
  initial-admin bootstrap and ADMIN/STAFF method authorization infrastructure.
- No User Management or role-protected production business API yet. Swagger/OpenAPI
  and api-contract/api.yaml describe the delivered login API; RBAC demonstration routes
  are test-only. No refresh token; wait for a dedicated issue.
- Payment/dispense/IoT purchase flow is approved design, not implemented functionality.

## Latest persistent decisions and next step

- New features: feature/<issue-number>-<description>; bug fixes: fix/<issue-number>-<description>.
  The temporary bug/ convention was revoked. Start new issue branches from latest dev.
- Only backend is in scope; do not modify apps/frontend/kiosk/firmware.
- Preserve Flyway schema authority and ddl-auto=validate; keep feature placeholders.
- Every API change requires understandable feature-grouped Swagger and a synchronized
  repository api-contract, including request/response, validation, errors and access rights.
- Every issue handoff reports its entire checklist, with evidence and reasons/next steps
  for every incomplete or unverified item; update CURRENT_TASK when a new issue is assigned.
- User handles merge manually. No commit/push/PR/merge/issue edits performed in this
  maintenance request. Wait for the user's next issue or explicit delivery instruction.

The branch and working-tree snapshot above must be rechecked in the next chat; do not
switch branches over pending issue #10 changes or infer that they have already been merged.
