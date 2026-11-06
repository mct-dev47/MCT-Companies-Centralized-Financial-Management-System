# 0034. Tenant Audit Tags and Table Refinements · Rationale

**Date**: 2026-11-06

## Context

The tenant commercial lease module currently shows dense table cells that duplicate information available in the detailed receipt view. Specifically, showing the lease reference code and stall unit under the tenant name creates extra visual clutter on desktop screens, while the dedicated contract date and due date columns push remaining balances and audit information far to the right.

Furthermore, following the successful audit visibility patterns introduced in lending and receivables, operational staff members across owner, supervisor, finance, and auditor roles need immediate clarity on whether a commercial lease has been audited or flagged with discrepancies. In the current interface, the audit tag column only appears when an auditor logs in, preventing finance officers and business owners from confirming audit validity before collection. Additionally, the status column renders with solid background pills that distract from the financial numbers.

In the tenant details view, the payment schedule and history table currently displays an actions column with edit and delete buttons. Because recorded payments represent verified financial transactions, direct deletion or modification in this view introduces reconciliation risks. Removing this column transforms the payment history into an immutable audit ledger, while adding creator attribution guarantees full transparency regarding who recorded each payment installment.

## Options considered

### Option 1: Minimal frontend only changes with placeholder creator names

This approach modifies table columns on the client only, parsing user IDs or hardcoding current user names for payment logs without backend name resolution.

**Pros**:
- Requires touching only frontend components.
- Fast to code without backend endpoint updates.

**Cons**:
- Fails to show real creator names for past payments created by different staff members.
- Breaks down when multiple finance officers record transactions across shifts.

### Option 2: Unified full stack refinement matching lending conventions (Recommended)

This approach eliminates redundant table columns, strips status pills down to legible colored typography, exposes multi line audit tooltips for all authorized roles, locks payment history into an immutable ledger, and wires backend user name resolution for payment creators.

**Pros**:
- Consistent with design patterns ratified in Lending (spec 0031) and Receivables.
- Full name resolution provides genuine accountability for every payment entry.
- Removing edit and delete buttons prevents accidental payment tampering.
- Clean typography without background pills improves overall table legibility.

**Cons**:
- Requires updating both frontend views and backend tenant payment response formatting.

