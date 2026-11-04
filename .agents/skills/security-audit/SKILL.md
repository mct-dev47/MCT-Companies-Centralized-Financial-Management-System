---
name: security-audit
description: >-
  Scans git diffs, staged files, backend endpoints, and frontend components for
  secrets, credential leaks, broken access control, and web security vulnerabilities.
---

# Security Audit Skill

Use this skill before running `github-pr` or whenever validating recent changes for potential security weaknesses or leaked secrets.

## Inspection Checklist

### 1. Secret & Credential Detection
Search the diff and new files for patterns that match:
- High entropy strings, API tokens, JWT secrets, Supabase service role keys.
- Database connection strings containing passwords (e.g. `postgresql://user:pass@host/db`).
- Private keys (`BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`).
- Tracked `.env` or credential files (must match `.gitignore`).

### 2. Authorization & Broken Access Control (BAC)
- Verify that endpoints do not rely solely on untrusted client headers (e.g. `X-User-Role`, `X-User-Name`) for authorization decisions without server-side JWT verification.
- Ensure sensitive administrative and financial actions require explicit role checks (e.g. `require_admin_user`, `require_finance_or_admin_user`).
- Confirm multi-tenant boundary checks: verify that users cannot access records of another company unless authorized as central admin, finance, or audit.

### 3. Injection Prevention
- Confirm all database queries use SQLAlchemy ORM or parameterized text statements (`text("... :param")`). Never use raw f-strings or string concatenation for SQL queries.
- Ensure shell command invocations (if any) avoid user input interpolation.

### 4. Frontend Security & Data Exposure
- Ensure no sensitive authentication tokens or plaintext passwords are saved in `localStorage` or logged to `console.log`.
- Avoid raw HTML rendering (`dangerouslySetInnerHTML`).
- Ensure sensitive error tracebacks from the backend are caught and not surfaced directly to unauthenticated clients.

### 5. Git & Repository Hygiene
- Check `git status --short` to ensure no transient SQLite databases (`*.db`), SSL keys (`nginx/ssl/`), IDE folders (`.gemini/`), or build artifacts (`dist/`) are staged.
