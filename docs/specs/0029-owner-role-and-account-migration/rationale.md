# 0029. Owner Role and Manuel Account Email Migration: Rationale and Context

**Date**: 2026-11-04
**Status**: Context and Decision Record

## Context

The system currently accommodates Manuel using brittle email matching logic across multiple user interface screens. Specifically, frontend components check whether the authenticated user email contains the word manuel to suppress mutation and audit approval buttons. This pattern creates security and maintainability risks, particularly when account details change or when new screens are developed.

Manuel requires an email change from manuel@mct.com to ryuuujin.sh@gmail.com. Changing this email directly without updating the hardcoded logic would break all existing restrictions, unintentionally exposing edit and audit controls.

To resolve this sustainably and align with our core authentication standards, the application needs a first class Owner role. This role must grant complete global read access across all financial modules while strictly preventing any record creation, editing, deletion, or audit status changes.

## Options considered

### Option 1: First class Owner role with database migration (Recommended)

Add owner as an authoritative role across the backend user model, schema validators, frontend user session types, and role mapping. Provide an idempotent SQL migration that updates Manuel's existing record to ryuuujin.sh@gmail.com with role owner. Update all frontend action gates to check role equals owner.

**Pros**:
- Establishes a clean and extensible role based access model aligned with our authentication architecture.
- Eliminates brittle email keyword matching across frontend components.
- Enforces view only restrictions at both backend dependency layer and frontend presentation layer.

**Cons**:
- Requires updating role validators in backend schemas and frontend type unions.

### Option 2: Update hardcoded email strings to ryuuujin.sh@gmail.com

Keep the existing role as audit or supervisor, change the email in the database, and replace includes manuel with includes ryuuujin across all frontend files.

**Pros**:
- Requires minimal code changes in the immediate term.

**Cons**:
- Perpetuates the hardcoded identity antipattern prohibited by our security specifications.
- Fails to provide backend authorization enforcement for the view only restriction.
- Easily breaks if another executive or investor requires view only access in the future.

### Option 3: Add a generic is_view_only boolean flag to existing roles

Keep the user role as audit or admin, but add an is_view_only column to the database and session object.

**Pros**:
- Allows any existing role to become view only.

**Cons**:
- Increases data model complexity when a clear Owner persona already exists.
- Requires modifying database table structure and session schemas for a single executive role requirement.

## Rationale

Option 1 provides architectural clarity and eliminates technical debt. Our previous specification 0019 explicitly prohibited hardcoding names or matching email patterns to determine permissions. Introducing owner as an official role gives the business a clean way to model executive and investor oversight without granting dangerous mutation capabilities.

