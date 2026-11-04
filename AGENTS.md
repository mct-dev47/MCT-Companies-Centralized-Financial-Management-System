# MCT Agents & Skills Registry

This workspace is configured with specialized agent personas and on-demand skills under `.agents/`.

## Available Agents
- **`develop`** ([.agents/agents/develop.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/agents/develop.md)): The builder agent that implements UI screens, backend endpoints, and business logic from specifications, validating input coverage and managing scope/spec states.
- **`github-pr`** ([.agents/agents/github-pr.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/agents/github-pr.md)): Specialized in staging changes, creating semantic branch names, pushing commits to remote, and opening pull requests to the `dev` branch via the GitHub CLI.
- **`security-auditor`** ([.agents/agents/security-auditor.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/agents/security-auditor.md)): Inspects changes for hardcoded secrets, credential leaks, broken access control, and web security vulnerabilities before commit or merge.

## Available Skills
- **`develop`** ([.agents/skills/develop/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/develop/SKILL.md)): The builder skill that turns specifications and design tokens into functional UI and logical backend code, with strict spec gatekeeping.
- **`architect`** ([.agents/skills/architect/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/architect/SKILL.md)): Makes architectural and design decisions, writing them as build specs in `docs/specs/`.
- **`scope`** ([.agents/skills/scope/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/scope/SKILL.md)): Breaks product ideas into ordered slices and tracks progress across features.
- **`audit`** ([.agents/skills/audit/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/audit/SKILL.md)): Inspects the codebase and establishes context and conventions.
- **`check`** ([.agents/skills/check/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/check/SKILL.md)): Confirms implementations through live execution verification and cross-model code review.
- **`test`** ([.agents/skills/test/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/test/SKILL.md)): Generates test suites for modified files and features.
- **`document`** ([.agents/skills/document/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/document/SKILL.md)): Drafts PR bodies, changelogs, release notes, and documentation from code diffs.
- **`sync`** ([.agents/skills/sync/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/sync/SKILL.md)): Synchronizes context files, specs, and scope tracking with codebase reality.
- **`debug`** ([.agents/skills/debug/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/debug/SKILL.md)): Diagnoses root causes for bugs and prepares regression tests.
- **`code-reviewer`** ([.agents/skills/code-reviewer/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/code-reviewer/SKILL.md)): Automated static analysis, security check, and code quality review before submitting pull requests.
- **`security-audit`** ([.agents/skills/security-audit/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/security-audit/SKILL.md)): Scans git diffs, staged files, backend endpoints, and frontend components for secrets, credential leaks, and vulnerabilities.
- **`github-pr`** ([.agents/skills/github-pr/SKILL.md](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/.agents/skills/github-pr/SKILL.md)): Automated workflow runbook for git branching, pushing to remote, and generating pull requests targeting `dev`.

## General Project Conventions
- The base integration branch is `dev`.
- Production branch is `main`.
- All PRs should have a clear descriptive title following conventional commits (e.g. `feat:`, `fix:`, `chore:`, `docs:`) and a structured body.
