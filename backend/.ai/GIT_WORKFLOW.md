!Normally, I handle these tasks manually; you only need to read this file to understand my workflow with GitHub. You should only carry out the actions mentioned below when instructed to do so.!

# Git Workflow

## 1. Main Branches

The project uses:

```text
main
dev
```

### main

Contains stable/release-ready code.

Do not implement features directly on `main`.

### dev

Integration branch for ongoing development.

Completed feature/fix branches are merged into `dev`.

Do not normally develop directly on `dev`.

---

## 2. Development Flow

Normal workflow:

```text
GitHub Issue
      ↓
Update local dev
      ↓
Create branch from dev
      ↓
Implementation
      ↓
Tests
      ↓
Commit
      ↓
Push
      ↓
Pull Request
      ↓
Review
      ↓
Merge into dev
      ↓
Close Issue
```

The next issue branch should normally be created from the latest `dev`, not from the previous feature branch.

---

## 3. Issues

Every meaningful feature or bug should have a GitHub Issue.

Examples:

```text
[BE] Setup common backend foundation

[BE] Implement User and Role persistence layer

[BE] Implement JWT authentication

[BUG] Prevent duplicate payment webhook processing
```

GitHub assigns the Issue number.

Do not manually invent Issue numbers before the Issue exists.

---

## 4. Branch Naming

Feature:

```text
feature/<issue-number>-<description>
```

Example:

```text
feature/3-user-role-persistence
```

Bug fix:

```text
fix/<issue-number>-<description>
```

Example:

```text
fix/27-duplicate-payment-webhook
```

Refactoring:

```text
refactor/<issue-number>-<description>
```

Documentation:

```text
docs/<issue-number>-<description>
```

Use lowercase kebab-case.

---

## 5. Creating a Feature Branch

Always update `dev` first.

```bash
git checkout dev
git pull origin dev
```

Then:

```bash
git checkout -b feature/3-user-role-persistence
```

Do not normally create:

```text
feature/3
    ↓
feature/4
    ↓
feature/5
```

Feature branches should independently originate from the appropriate current `dev`.

---

## 6. Commits

Use Conventional Commit-style messages.

Examples:

```text
feat: implement user and role entities
feat: add user role repository queries

fix: prevent duplicate user email

test: add user repository tests

refactor: simplify product mapping

docs: update database documentation
```

Issue number may be included:

```text
feat: implement user and role persistence (#3)
```

Avoid meaningless messages:

```text
update
fix
done
changes
code
final
```

---

## 7. Commit Scope

Commits should be logically focused.

Do not combine unrelated work such as:

```text
User persistence
+
Payment refactor
+
README rewrite
```

in one commit without a strong reason.

AI-generated changes must be reviewed before commit.

---

## 8. Push

Example:

```bash
git push -u origin feature/3-user-role-persistence
```

---

## 9. Pull Requests

Feature branches target:

```text
dev
```

Example:

```text
feature/3-user-role-persistence
              ↓
             dev
```

PR title should match the Issue closely.

Example:

```text
[BE] Implement User and Role persistence layer
```

---

## 10. Pull Request Description

Recommended template:

```markdown
## Summary

Implement User and Role persistence based on the existing Flyway schema.

## Changes

- Added User entity
- Added Role entity
- Added User/Role mapping
- Added repositories
- Added persistence tests

## Testing

- [x] Project compiles
- [x] Tests pass
- [x] Flyway validation passes
- [x] Hibernate schema validation passes

## Related Issue

Closes #3
```

Use the actual Issue number.

---

## 11. Issue Linking

Maintain traceability:

```text
Issue #3
    ↓
feature/3-user-role-persistence
    ↓
commit ... (#3)
    ↓
Pull Request
    ↓
Issue #3
```

Branch naming is a convention.

The PR should also be explicitly linked to the Issue.

---

## 12. Merge Requirements

Before merge:

- [ ] Issue acceptance criteria satisfied
- [ ] Code reviewed
- [ ] Tests pass
- [ ] No unrelated changes
- [ ] No secrets
- [ ] No accidental migration modifications
- [ ] Database changes use new migrations
- [ ] Documentation updated if architecture/schema changed

Then merge into:

```text
dev
```

---

## 13. After Merge

Update local `dev`:

```bash
git checkout dev
git pull origin dev
```

Optionally delete the completed local branch:

```bash
git branch -d feature/3-user-role-persistence
```

Remote branch can also be deleted after merge.

The next feature branch should then be created from the updated `dev`.

---

## 14. Bug Workflow

When a real bug is discovered and needs tracking:

Create an Issue.

Example:

```text
#27 [BUG] Duplicate payment webhook can trigger processing twice
```

Create:

```text
fix/27-duplicate-payment-webhook
```

Workflow:

```text
Bug Issue
   ↓
fix branch
   ↓
Fix
   ↓
Regression test
   ↓
PR
   ↓
dev
```

Do not silently fix significant unrelated bugs inside another feature branch.

Small defects directly caused by the current unfinished feature may be fixed within that feature issue when they are part of its acceptance criteria.

---

## 15. Milestones

Issues should be assigned to the appropriate milestone.

Current milestone:

```text
M1 - Backend Core Foundation
```

Planned scope:

```text
Database/Flyway
Backend Foundation
User/Role Persistence
JWT Authentication
ADMIN/STAFF Authorization
User Management
Product Management
Machine Management
Machine Slot Management
Product Batch Management
Inventory Management
Swagger/OpenAPI
Core Tests
```

Future milestones:

```text
M2 - IoT & Monitoring
M3 - Order & Payment
M4 - Dispensing & Machine Control
M5 - Dashboard, Reports & Production Readiness
```

---

## 16. Database Migration Workflow

Database changes require a new migration.

Example:

```text
Issue
 ↓
Schema change identified
 ↓
Create V9__....sql
 ↓
Run migration
 ↓
Run tests
 ↓
Update DATABASE.md if required
 ↓
PR
```

Never modify an applied migration merely to keep migration numbering clean.

Migration history is history.

---

## 17. AI Development Workflow

When AI is used to implement an Issue:

```text
Create Issue
    ↓
Create branch
    ↓
Tell AI the Issue number/scope
    ↓
AI reads AGENTS.md + .ai docs
    ↓
AI inspects existing code
    ↓
AI implements only Issue scope
    ↓
AI runs tests
    ↓
Developer reviews git diff
    ↓
Commit
    ↓
PR
```

Never blindly commit AI-generated code.

The developer remains responsible for reviewing:

- architecture
- security
- database changes
- tests
- unexpected file changes

---

## 18. Release Flow

When a set of features in `dev` is stable and ready for release:

```text
dev
   ↓
Pull Request
   ↓
main
```

`main` should remain stable.

Release/version tagging may be introduced later when deployment begins.
