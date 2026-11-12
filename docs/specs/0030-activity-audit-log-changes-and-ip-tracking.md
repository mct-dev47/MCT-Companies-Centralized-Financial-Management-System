# 0030. Enhance activity audit log with client IP tracking and change diff inspection

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This decision enhances the central admin activity log at `/activity-log` by displaying client IP addresses and structured before and after record change diffs. Administrators can now inspect who made an edit, when it happened, which record was affected, what values changed, and from which IP and device. Changes are captured through a lightweight backend diff helper with automatic secret redaction, and displayed in a responsive side drawer modal.

## Context

The system tracks activity logs in the database, but administrators currently see only high level descriptions like company name, user name, action, and target text. When a financial transaction, petty cash voucher, loan, or tenant record is edited or deleted, administrators cannot verify what specific values were modified or what the original values were.

Client IP addresses are also captured partially in the database schema but are omitted from the frontend table, the export files, and the client service interfaces. When an unauthorized action or security discrepancy occurs, administrators lack immediate client network context and device user agent visibility.

A complete audit trail requires answering five fundamental questions for every critical mutation: who performed the action, what action occurred, when did it happen, which record was affected, and what exact field values changed. Resolving this without disrupting live database tables or requiring heavy external logging infrastructure is essential for the team.

## Requirements

**User stories**:
- As a central administrator, I want to see the client IP address in the activity log table with a quick copy action so that I can immediately trace the network origin of any action.
- As a central administrator, I want to open a detailed inspection drawer for any log entry to view the before and after field values so that I understand exactly what was changed on a record.
- As a central administrator, I want sensitive fields such as passwords, pin codes, and secrets automatically masked so that audit records do not leak confidential credentials.
- As a central administrator, I want to export activity records including IP addresses and affected record identifiers to CSV and PDF so that compliance reviews have complete evidence.

**Acceptance criteria**:
- **AC-1**: The admin activity log table displays a dedicated column for client IP address with a monospace font and a single click copy button.
- **AC-2**: Clicking any row or an inspect action opens a side drawer modal that reveals the full event details, actor profile, severity badge, network and device user agent, and a formatted change diff table.
- **AC-3**: The change diff table highlights modified attributes with clear old value and new value indicators, displaying formatted numbers, currency badges, and booleans with human readable labels.
- **AC-4**: A backend diff helper computes structured changes for create, update, and delete actions, safely recording changes inside the log details payload.
- **AC-5**: The backend diff helper automatically redacts sensitive keys, including password, pin, token, secret, and authorization credentials, substituting them with redacted placeholder text.
- **AC-6**: Backend request middleware and utility dependencies extract client IP addresses reliably, prioritizing forwarded proxy headers (`X-Forwarded-For`, `X-Real-IP`) before falling back to client host.
- **AC-7**: Exporting logs to CSV and PDF includes the client IP address, affected record identifier, and severity classification.

## Options considered

### Option 1: Fix in place with structured JSON details and responsive inspection drawer

Enhance the existing `audit_logs` table and `ActivityLogService` by standardizing the `details` JSON field to store `record_type`, `record_id`, `record_ref`, `severity`, `user_agent`, and a `changes` dictionary containing old and new values. In the frontend, add the IP column and a side drawer modal for inspecting field diffs.

**Pros**:
- Works immediately with existing database tables and Supabase storage without running breaking schema migrations.
- Highly flexible for different business models such as loans, petty cash, leases, expenses, and user permissions.
- Minimal operational complexity and zero third party infrastructure costs.

**Cons**:
- Querying directly inside deep JSON fields in PostgreSQL requires JSON operators rather than simple indexed foreign keys.

### Option 2: Add dedicated relational columns for every audit attribute and table level SQL diffing

Alter the database schema to add first class columns for record type, record identifier, severity, client user agent, and create a separate `audit_log_changes` child table with foreign keys.

**Pros**:
- Strict relational constraints and normalized schema.
- Native SQL indexing across all individual diff attributes.

**Cons**:
- Requires coordinating multi table database migrations across live Supabase and local SQLite databases.
- Introduces higher write amplification on high frequency financial transactions.
- Increases maintenance friction when new entity types introduce diverse attributes.

### Option 3: Full external SIEM and third party audit pipeline

Stream all operational events to an external SaaS logging service such as Datadog, AWS CloudWatch, or Logstash.

**Pros**:
- Offloads log storage and retention processing to managed infrastructure.
- Offers out of the box anomaly detection and external alerting.

**Cons**:
- Significantly increases monthly recurring software costs.
- Introduces external network latency and dependency on third party availability.
- Does not solve the requirement for an integrated admin UI at `http://localhost:5174/activity-log`.

## Decision

**Chosen option**: Option 1: Fix in place with structured JSON details and responsive inspection drawer

Enhance the current activity log architecture by standardizing the JSON details payload, adding the IP address column to the main table, and introducing an inspection drawer modal that renders field level diffs cleanly.

**Implementation skills**: `develop` (`mct/develop`, `.agents/skills/develop/`)

## Rationale

Option 1 provides maximum value with zero downtime and no risky schema migrations. The existing `audit_logs` table already includes `ip_address` and `details` columns. By providing a clean Python diff utility and standardizing the JSON format, the backend services can immediately begin recording rich changes. The frontend can extract these structured properties and present an intuitive visual diff without adding heavy third party dependencies.

## Feature design

**Data model sketch**:

Existing `audit_logs` database table (PostgreSQL and SQLite):
- `audit_log_id`: Integer, primary key, autoincrement
- `company_id`: Integer, foreign key to `company.company_id`, nullable
- `user_id`: Integer, foreign key to `users.user_id`, nullable
- `action`: String(255), not null (example: `EXPENSE_UPDATED`, `LOAN_CREATED`)
- `action_category`: String(50), nullable (example: `FINANCE`, `AUTH`, `TENANT`)
- `ip_address`: String(45), nullable (stores IPv4 or IPv6 string)
- `details`: Text or JSON, stores the structured JSON payload below
- `created_at`: DateTime with timezone, server default `func.now()`

Standardized `details` JSON structure:
```json
{
  "record_type": "expense",
  "record_id": 105,
  "record_ref": "EXP-2026-0042",
  "severity": "INFO",
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
  "changes": {
    "amount": { "old": 15000.0, "new": 17500.0 },
    "description": { "old": "Office supplies", "new": "Office supplies and printer toner" },
    "status": { "old": "PENDING", "new": "APPROVED" }
  },
  "metadata": {
    "reason": "Adjusted invoice amount per receipt update"
  }
}
```

Pydantic schema additions (`app/schemas/activity_log.py`):
- `ActivityLogOut`:
  - `ip_address`: Optional[str]
  - `severity`: str = "INFO" (values: `INFO`, `WARNING`, `CRITICAL`)
  - `record_type`: Optional[str]
  - `record_id`: Optional[str | int]
  - `record_ref`: Optional[str]
  - `user_agent`: Optional[str]
  - `changes`: Optional[Dict[str, Dict[str, Any]]]

TypeScript interface additions (`frontend/src/services/activityLogService.ts`):
- `ActivityLogItem`:
  - `id`: string
  - `company`: string
  - `user`: string
  - `userRole`: string
  - `action`: string
  - `module`: string
  - `target`: string
  - `time`: string
  - `ipAddress`: string
  - `severity`: "INFO" | "WARNING" | "CRITICAL"
  - `recordType`?: string
  - `recordId`?: string | number
  - `recordRef`?: string
  - `userAgent`?: string
  - `changes`?: Record<string, { old: unknown; new: unknown }>
  - `rawDetails`?: Record<string, unknown>

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/activity-logs` | GET | `search`, `user_id`, `company_id`, `module`, `severity`, `start_date`, `end_date`, `limit`, `offset` | List of `ActivityLogOut` objects with enriched IP and diffs | Central Admin Bearer Token | 401 Unauthorized, 403 Forbidden |
| `/api/v1/activity-logs/{id}` | GET | `id: int` path parameter | Single enriched `ActivityLogOut` record | Central Admin Bearer Token | 401 Unauthorized, 403 Forbidden, 404 Not Found |
| `/api/v1/activity-logs/purge-expired` | POST | `retention_days: int` query parameter (default 180) | `purged_count`, `cutoff_date`, `message` | Central Admin Bearer Token | 401 Unauthorized, 403 Forbidden |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| List activity logs | IP address text | Stored `ip_address` column on `audit_logs` record |
| Inspect log entry | Actor user name and email | Resolved from `users` relation or snapshot details |
| Inspect log entry | Severity pill badge | Extracted from `details.severity`, defaults to `INFO` |
| Inspect log entry | Field change diff table | Extracted from `details.changes` dictionary |
| Inspect log entry | Device user agent text | Extracted from `details.user_agent` string |
| Record mutation | Client IP address | Extracted from request `X-Forwarded-For` or `request.client.host` |
| Record mutation | Record identifier and reference | Derived from service target entity identifier |

**Key invariants**:
- Audit records are append only. No API endpoint or user action may edit or alter an existing activity log row.
- Automated 180 day retention policy is the only mechanism permitted to delete old log records.
- Passwords, secret keys, tokens, and verification codes must be scrubbed before persisting to the log details.
- When an IP address cannot be determined, the system stores `None` and displays a neutral dash placeholder rather than failing the primary operation.

**Security model**:
- Access to view or export activity logs is restricted strictly to users with the Central Administrator role.
- All endpoints enforce JWT bearer token authentication and reject non admin roles with HTTP 403 Forbidden.
- Sensitive values are redacted at log creation time so that sensitive credentials never enter storage.

**Critical test scenarios**:
- Happy path: Administrator views `/activity-log`, sees the IP address column, clicks inspect, and reviews the side drawer showing old versus new values, verifies **AC-1**, **AC-2**, **AC-3**.
- Redaction verification: An administrative user updates account profile details including a new password; the audit log records the profile update diff while the password field displays `[REDACTED]`, verifies **AC-4**, **AC-5**.
- Network extraction: An authenticated request routed through an HTTP reverse proxy has its client IP correctly captured from the `X-Forwarded-For` header, verifies **AC-6**.
- Export coverage: An administrator downloads the CSV and PDF reports; both files contain the IP address and record reference columns, verifies **AC-7**.

## Migration plan

**Strategy**: No migration needed

The database columns `ip_address` and `details` already exist in the `audit_logs` table. New records will automatically write the structured JSON schema. Existing records with legacy details strings or missing IP values are handled gracefully by fallback parsers on both backend and frontend.

## Build plan

- [x] 1. Backend diff helper and IP extraction utility: Implement `compute_dict_diff` with automatic sensitive key masking and `get_client_ip` utility in `app/core/audit.py`, satisfies **AC-4**, **AC-5**, **AC-6**.
- [x] 2. Service enrichment update: Update `app/services/activity_log_service.py` and `app/schemas/activity_log.py` to extract `severity`, `record_type`, `record_id`, `record_ref`, `user_agent`, and `changes` from the details JSON, satisfies **AC-2**, **AC-4**.
- [x] 3. Frontend service extension: Update `frontend/src/services/activityLogService.ts` to include `ipAddress`, `severity`, `recordRef`, `userAgent`, and `changes` in the returned `ActivityLogItem`, satisfies **AC-1**, **AC-2**.
- [x] 4. Activity log table IP column and quick copy: Add the IP address column to `ActivityLogPage.tsx` with monospace styling, copy icon, and tooltip notification, satisfies **AC-1**.
- [x] 5. Activity log detail drawer modal: Create an inspection drawer component in `frontend/src/components/admin/ActivityLogDetailDrawer.tsx` that renders who performed the action, timestamp, record badge, IP, user agent, and field by field diff table, satisfies **AC-2**, **AC-3**.
- [x] 6. Export updates: Update CSV and PDF export generators in `ActivityLogPage.tsx` to include the client IP address and record reference, satisfies **AC-7**.

## Consequences

Positive consequences:
- Administrators have complete accountability and visibility into financial and administrative changes.
- Security incidents can be localized quickly with network IP addresses and device user agents.
- The change diff view clarifies disputes and accidental modifications without requiring manual database queries.

Negative consequences and tradeoffs:
- Storing before and after diffs in the details column slightly increases row storage size for large batch operations.
- The table requires one additional column, necessitating responsive horizontal scroll handling on tablet viewports.

## Follow-up

- [ ] Connect the `compute_dict_diff` helper into existing high volume mutation endpoints (expenses, petty cash vouchers, bank transfers, tenant payments).
- [ ] Add an IP address search filter to the top filter toolbar for quick forensic investigations.

