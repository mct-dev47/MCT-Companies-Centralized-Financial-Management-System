# 0002. Three Tier Review Pipeline for Petty Cash and Loans

**Date**: 2026-10-27
**Status**: Accepted

## Summary

This specification establishes a unified three tier workflow across MCT subsidiary companies, central finance, and internal audit for both petty cash replenishments and inter company loans. A subsidiary branch submits a request, which routes exclusively to the central finance team for review. Audit cannot view or interact with initial unendorsed submissions. Finance evaluates the request and endorses it forward to Audit, or rejects it. Only upon Finance endorsement does the transaction surface in the Audit view, where internal auditors perform the final authoritative approval or disapproval with mandatory remarks.

## Context

Previously, the terminology around approvals was ambiguous because both finance officers and auditors were labeled as approving transactions. This created confusion regarding who carried primary funding responsibility versus who conducted independent compliance checks. Furthermore, auditors could see unreviewed draft submissions before finance had assigned lenders or verified treasury availability.

By creating distinct stages with distinct operational verbs, roles are clearly separated:
1. Companies submit requests.
2. Finance endorses or rejects requests (assigning lenders for loans and verifying company allocations).
3. Audit grants final approval or disapproval.

## Requirements

**User stories**:
- As a company user, I want to submit petty cash or loan requests and track their progression through Finance endorsement and Audit approval.
- As a finance officer, I want to review incoming requests, assign funding lenders for loans, and endorse requests to the audit team with an explanation remark.
- As an auditor, I want to view only finance endorsed transactions, examine the full trail of particulars and finance remarks, and provide final approval or disapproval with a mandatory audit remark.

**Acceptance criteria**:
- **AC-1**: When a company submits a petty cash request, its initial status is `Pending Finance Endorsement`.
- **AC-2**: When a company submits a loan request, its initial status is `Pending Finance Endorsement`.
- **AC-3**: Auditor accounts cannot see petty cash or loan requests while they remain in `Pending Finance Endorsement`.
- **AC-4**: Finance officers can click any request in `Pending Finance Endorsement` to either `Endorse to Audit` or `Reject`, requiring a mandatory remark. For loans, Finance also selects the lending company.
- **AC-5**: Submitting Finance endorsement changes the status to `Pending Audit Approval`, saves `endorsed_by`, `endorsed_at`, and endorsement remarks, and makes the transaction visible to auditors.
- **AC-6**: Auditors can click any transaction in `Pending Audit Approval` to either `Approve` or `Disapprove`, requiring a mandatory audit remark.
- **AC-7**: Submitting Audit approval transitions status to `Approved`, saving `reviewed_by` and `reviewed_at`. For petty cash, this credits the company wallet balance. For loans, this activates the loan agreement and repayment tracking.

## Decision

Adopt the three tier status model across backend models, database columns, service validation layers, and frontend interfaces for both petty cash and inter company loans.
