# 0031. Lending Audit Workflow and Role Visibility Refinements (Rationale)

## Context

The lending module previously introduced borrower audit capabilities, but several user interface and data persistence gaps remained. The table column for audit status was restricted to users with auditor roles, hiding critical verification context from supervisors, finance officers, and owners. The audit tag in the table crowded auditor initials and timestamps into small table cells, degrading legibility on compact displays.

Within the borrower details view, audit metadata lacked a cohesive home. Auditors could not see who completed prior reviews or when they took place above the action buttons. Auditor findings and remarks were omitted from the agreement receipt view entirely. Furthermore, the discrepancy modal textarea rendered without proper box borders and only occupied half width styling, and the modal handlers only modified local React state without invoking backend audit persistence endpoints. Consequently, page reloads discarded entered findings.

This decision addresses all of these presentation and data flow shortcomings by establishing a clear role based layout, complete field styling, and end to end database persistence.

## Options considered

### Option 1: Large audit banner across the top of Lending Details

A prominent horizontal banner placed across the top of the details page displaying status, timestamps, and findings.

**Pros**:
- High visual prominence immediately upon entering the page.

**Cons**:
- Consumes significant vertical height before the financial agreement and ledger schedule.
- Clutters the view for standard repayment recording workflows.

### Option 2: Integrated audit panel inside the loan receipt card with header stamps for auditors

Placing auditor stamps above the audit action buttons in the header for auditors, while embedding a structured audit panel inside the left agreement receipt card for all roles.

**Pros**:
- Preserves the vertical alignment of the page and maintains a clean receipt aesthetic.
- Keeps audit action buttons and their contextual metadata grouped together for auditors.
- Gives non auditor roles a clean place to read audit remarks alongside loan terms without cluttering their header.

## Rationale

Option 2 honors the receipt metaphor of the left card in the Lending Details layout. The left card serves as the permanent financial dossier for the borrower, making it the natural place for official audit stamps and auditor notes. Keeping the auditor name and timestamp above the auditor buttons provides instant context when deciding whether to re-audit or adjust findings. For non auditor roles, leaving the header clean and displaying audit information inside the receipt card prevents visual noise while keeping the audit trail fully transparent.

