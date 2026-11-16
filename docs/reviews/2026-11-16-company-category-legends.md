# Review, dev, 2026-11-16

**Reviewed by**: Gemini 2.5 Pro (subagent review)
**Scope**: 13 files (11 modified, 2 untracked migrations)
**Verdict**: Approve with nits

## Summary
This change replaces hardcoded category lists with the user's real per-company categories stored in `company_categories` across the Dashboard, Sales, and Expense summary cards. It ensures that when no categories have been configured for a company, empty lists are returned and no misleading legend pills are rendered. The queries are backed by composite database indexes on `company_categories`, `sales`, and `category`, and the server-side aggregation accurately defaults unspent categories to ₱0 while ordering categories by highest amount first.

## Blockers
*None.*

## Major
*None.*

## Minor
### 🟡 Multi-company scope category collision, `backend/app/api/v1/endpoints/dashboard.py:270`
**Problem**: When scoped to multiple companies (for example an auditor or admin viewing "All Authorized Companies" where two companies happen to share a category name like "Catering"), `valid_sales_cats` maps lowercased name to canonical name globally across all scoped companies, and `categorized_sales_total` sums across those names.
**Why it matters**: For a single selected company (the primary usage pattern on the dashboard), this is completely clean and accurate. For multi-company rollups, companies sharing a category name will have their amounts combined under that single category name.
**Suggested fix**: This is the expected rollup behavior when aggregating across multiple companies. If per-company distinction in multi-company view is desired in the future, prefix or tag the category with the company abbreviation.

### 🟡 Case-insensitive matching on rename, `backend/app/api/v1/endpoints/categories.py:345`
**Problem**: When a `CompanyCategory` is renamed, `db.query(Sale).filter(Sale.company_id == comp_cat.company_id, Sale.category_id == old_global.category_id)` updates existing sales for that company. If another company also used `old_global`, its `category_id` correctly remains untouched, but if a sale had `category_id = NULL` (for example created before `Category` was seeded), it won't be caught by the update.
**Why it matters**: Historical sales with a NULL `category_id` will continue to show under Uncategorized rather than adopting the renamed category.
**Suggested fix**: In a future maintenance script or migration, ensure legacy sales with NULL `category_id` have their category names backfilled from particulars or notes if applicable.

## Nits
- ⚪ `frontend/src/utils/categoryConstants.ts:51`: Hash-based palette selection is deterministic and clean; consider adding more than 12 colors if a company defines a very large number of categories to avoid repeated adjacent colors.
- ⚪ `frontend/src/components/dashboard/CategorySummaryChart.tsx:409`: Tabular numbers format cleanly with `${Math.round(cat.amount / 1000)}k` when amount >= 1000, and `formatPHP(cat.amount)` for smaller non-zero values.

## Strengths
- **Index-backed performance**: The addition of `idx_company_categories_company_type_name`, `idx_sales_company_category_date`, and `idx_category_name` prevents full table scans during dashboard rendering and category retrieval.
- **Strict multi-tenant isolation**: A company with no categories receives an empty list and cleanly renders zero legend pills, completely eliminating hardcoded fake categories.
- **Zero-amount category preservation**: Categories created by the user remain visible with `₱0` even if no transactions have been recorded in the current filter period, meeting user expectations.
- **Cache coordination**: `system_cache.invalidate_tag("dashboard")` and `system_cache.invalidate_tag("categories")` ensure that creating, renaming, or deleting a category immediately busts the 60-second in-memory server cache.

## Test coverage
- All 5 test suites in `backend/tests/test_company_categories.py` passed with 100% assertions met:
  1. CRUD and isolation per company.
  2. Cross-company RBAC authorization checks.
  3. Legacy global category fallback.
  4. Automatic bank resolution for sales and expenses.
  5. Dashboard summary real category breakdown, zero-transaction states, transaction aggregations, and cache invalidation.
