# Spec 0044: Remaining Gaps & Future Roadmap Architecture (No Redis)

## Overview
This specification addresses the architectural design and operational blueprint for the remaining production gaps without introducing external Redis infrastructure:
1. **Frontend HTTP Security Headers & Content Security Policy (CSP)** in `frontend/vercel.json`
2. **Compound Database Query Indexing (PostgreSQL & SQLite)** for high-volume transactions
3. **Pagination Standardization on Legacy Endpoints (`/bills`, `/loans`)**
4. **Automated Off-Site Database Backup Archive & Supabase PITR Integration**
5. **Preserving Lightweight In-Memory / SQL Architecture** (Single-worker Uvicorn and SQL rate limiter)

---

## 1. Security & Headers (`frontend/vercel.json`)

### Problem
Frontend assets and the SPA HTML served by Vercel should enforce browser-level defenses against clickjacking, MIME-type sniffing, unauthorized cross-origin embedding, and XSS.

### Architecture & Specification
Add an explicit `"headers"` block to `frontend/vercel.json` applying across all routes (`/(.*)`):

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=(), payment=()"
        },
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=31536000; includeSubDomains; preload"
        },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://mct-companies-centralized-financial.onrender.com wss://mct-companies-centralized-financial.onrender.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
        }
      ]
    }
  ],
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://mct-companies-centralized-financial.onrender.com/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## 2. In-Memory & Database Rate Limiting (No Redis)

### Architecture & Specification
- Rate limiting continues using worker memory and the existing database table `rate_limits` via `RateLimitingMiddleware` and `backend/app/services/rate_limiter.py`.
- Automated data retention tasks (`0051_auth_data_retention.postgres.sql`) purge stale rate limit records automatically, protecting database storage.
- No Redis infrastructure or external cache provider is required.

---

## 3. WebSockets Architecture (Single-Worker Uvicorn)

### Architecture & Specification
- `backend/Dockerfile` continues using `uvicorn --workers 1`.
- This ensures all WebSocket connections share the same memory space in `ConnectionManager` without needing an external message broker.
- Connection pool limits with Supabase are safely conserved.

---

## 4. Off-Site Database Backup Archive & PITR

### Architecture & Specification
1. **Supabase PITR**:
   - Ensure Point-In-Time Recovery (PITR) is toggled on in the Supabase Dashboard (`Database -> Backups`).
2. **GitHub Actions Scheduled Daily Workflow**:
   - File: `.github/workflows/database-backup.yml`
   - Trigger: Cron schedule `0 2 * * *` (02:00 UTC / 10:00 AM PHT) plus `workflow_dispatch`.
   - Action:
     - Install `postgresql-client-16`.
     - Execute custom format compressed dump:
       ```bash
       pg_dump -Fc --no-owner --no-privileges "$SUPABASE_DIRECT_DB_URL" > "supabase_backup_$(date +%Y%m%d_%H%M%S).dump"
       ```
     - Encrypt the dump file before uploading to AWS S3 / Cloudflare R2 / Google Cloud Storage.
     - 30-day lifecycle retention policy.

---

## 5. Pagination Standardization on Older Endpoints

### Architecture & Specification
- Adopt `PaginationParams` across both `/api/v1/bills` and `/api/v1/loans`:
  - Query parameters: `limit` (default: 50, max: 100), `offset` (default: 0).
  - Return type: `List[BillOut]` and `List[LoanOut]` (ensures backward compatibility for frontend clients).
  - Include pagination metadata in response headers:
    - `X-Total-Count`: Total number of matching records.
    - `X-Page-Limit`: Current page size limit.
    - `X-Page-Offset`: Current offset index.
- Implementation:
  - In `backend/app/api/v1/endpoints/bills.py`: Inject `Response` and populate headers.
  - In `backend/app/api/v1/endpoints/loans.py`: Update `get_loans` to accept `pagination: PaginationParams = Depends()` and slice queries appropriately.

---

## 6. Database Compound Query Indexing

### Architecture & Specification
Create migration `0058_compound_performance_indexes.postgres.sql` (and SQLite equivalent):
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_company_transaction_date 
  ON sales (company_id, transaction_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_company_deposit_status 
  ON sales (company_id, deposit_status, transaction_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_company_expense_date 
  ON expenses (company_id, expense_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_account_date 
  ON bank_transactions (bank_account_id, transaction_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bills_company_due_date 
  ON bills (company_id, due_date ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_borrower_date 
  ON loan (borrower, loan_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_lender_date 
  ON loan (lender, loan_date DESC);
```
Register migration version `0058_compound_performance_indexes` in `backend/app/db/migrations.py`.
