# Backend CI

backend-tests.yml runs all backend tests on Java21 with Docker-backed PostgreSQL18
Testcontainers. It uses the same module command as local regression verification:
`mvn --batch-mode --no-transfer-progress clean verify`. Existing *Test naming is
discovered by Surefire; unit and integration tests are not separated or excluded.

Runs on backend/contract/docs/workflow changes in PRs to dev/main and pushes to
dev/main/feature/**/fix/**; workflow_dispatch supports manual runs after publishing.
There is no shared DB service, production secret, test skip or continue-on-error.
Surefire reports upload with always(), including failures. A Maven test failure
fails the job. GitHub-hosted Ubuntu24.04 provides Docker; docker info verifies it.

Actions use verified official commit SHAs. See docs/core-integration-testing.md for
test architecture, coverage, local prerequisites and remote verification status.
