# 0047 — Sales and Receivables for Tenant and Lending Companies

**Status:** Implemented

## Goal

JK Property and Ventures (Tenants) and FilCap Prime Holdings (Lending) get the **Sales** and **Receivables** tabs back. This reverses the earlier rule that these two companies use Tenants / Lending *instead of* Sales.

Sales recorded for these companies work the same as for every other company:
- They appear on the **Transactions** page with their deposit status.
- Deposited sales post to the chosen account's ledger on the **Bank** page.
- Unpaid sale lines become **Receivables**.

## Sidebar (non-admin roles)

```
Operations: Sales, Receivables, Expense, Loan, Bank, + Lending (FilCap) / Tenants (JK)
```

## Double-entry warning

Tenant rent and loan collections already post to Transactions and Bank from their own pages. A non-blocking amber notice shows on `/sales` and `/sales/add` for JK and FilCap, telling users not to enter that money again as Sales. Saving is **not** blocked.

## Changes

| File | Change |
|---|---|
| `frontend/src/config/companyFeatures.ts` | Removed `isSalesEnabledCompany` / `isSalesBlockedForCompany`; added `getSalesDoubleEntryWarning` |
| `frontend/src/components/layout/navItems.ts` | Sales + Receivables shown for every company |
| `frontend/src/components/layout/RouteGuards.tsx` | `SalesRouteGuard` no longer blocks by company (still redirects Admin) |
| `frontend/src/components/dashboard/SalesDoubleEntryWarning.tsx` | New notice component |
| `frontend/src/pages/SalesPage.tsx`, `AddTransactionSheetPage.tsx` | Render the notice |

The backend never blocked Sales by company, so no backend change was needed.
