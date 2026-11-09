# 0040. Password Reset and Initial Account Password Setup Security: Rationale

## Context

The centralized financial management system provisions user accounts through an administrative workflow where newly hired managers, accountants, and supervisors receive an email invitation to establish their initial password. While the initial setup mechanism functioned, the invitation magic links lacked a hard backend expiration boundary, allowing older setup links to remain usable indefinitely. Furthermore, users lacked a self service mechanism to recover forgotten passwords from the login screen, requiring manual administrator intervention to regain account access.

Financial systems handle sensitive transaction ledgers, bank disbursements, and loan portfolios. Password recovery is a prime target for credential stuffing, account enumeration, token replay, and session hijacking. When a user resets their password, any existing active sessions, refresh cookies, or compromised device tokens must be terminated immediately. Magic links sent through email are frequently opened by automated corporate security crawlers and link preview scanners; if link redemption occurs via a simple HTTP GET request, tokens can be prematurely consumed before the human recipient even opens the message.

The architecture must satisfy two distinct authentication needs without introducing duplicate frontend interfaces or redundant database tables. Initial account setup requires a generous 24 hour window suitable for employee onboarding, while password recovery requires a tight 30 minute lifetime to limit exposure windows. Both flows must enforce cryptographic token hashing, atomic single use redemption, strict password complexity validation, and complete session revocation upon credential change.

## Options considered

### Option 1: Unified Token Schema with Strict Purpose Isolation, URL Fragment Scrubbing, and Reused Set Password Interface

Extend the existing `user_invitations` table by adding a `purpose` column (`initial_password_setup` and `password_reset`). Magic links carry tokens inside URL fragments rather than query parameters, preventing tokens from leaking in server logs or Referrer headers. The frontend extracts the token on mount, scrubs the URL, and invokes a read only POST validation endpoint to inspect the token and determine the view title. Atomic single use redemption occurs only upon explicit password submission. Password reset increments `token_version` on the user record to invalidate all active sessions immediately.

**Pros**:
* Reuses existing outbox queuing, Brevo email infrastructure, and resilience circuit breakers without creating redundant tables.
* Consolidates frontend password setup into a single, well tested interface that dynamically adapts to verified token purposes.
* Prevents token leakage to network logs, browser histories, and external referrers.
* Guarantees atomic consumption and immediate multi device session invalidation upon password update.
* Mitigates timing enumeration via duration floor padding (150 to 200 milliseconds) and a 60 second silent resend cooldown.

**Cons**:
* Reusing the invitations table means the table name is historical, though its columns represent generic security tokens.

### Option 2: Dedicated Separate Table for Password Resets with Independent Email Pipeline

Create a new table named `password_reset_tokens` alongside a separate outbox table and build a dedicated reset password modal on the frontend, leaving the existing invitation system unchanged.

**Pros**:
* Keeps the invitation code isolated from the password recovery code.

**Cons**:
* Duplicates token generation, hashing, rate limiting, and email dispatch logic across two nearly identical pipelines.
* Creates two distinct password input dialogs that must both maintain identical accessibility, password complexity rules, and mobile responsive styling.
* Increases database maintenance overhead and schema complexity.

### Option 3: Third Party Delegated Auth Handling via Supabase Hosted Recovery

Delegate the entire password reset and invitation flow to Supabase hosted email links and templates.

**Pros**:
* Reduces custom backend token storage code.

**Cons**:
* Breaks integration with the existing transactional email service (Brevo) and customized company branding.
* Bypasses the application session management and `token_version` revocation controls established in spec 0039.
* Exposes Supabase redirect endpoints and limits fine grained rate limiting and audit logging.

## Rationale

Option 1 is selected because it builds directly on the application's existing, hardened security foundations while maintaining strict purpose isolation. The `user_invitations` table already implements SHA-256 token hashing, atomic status transitions, and integration with the resilient `invitation_outbox` worker. Adding a `purpose` column requires a minimal, safe database migration and allows both flows to benefit from existing circuit breakers and retry mechanics.

Strict purpose separation ensures that an initial setup token cannot be manipulated to execute a password reset, and a reset token cannot bypass administrative onboarding rules. Storing tokens as SHA-256 hashes prevents credential leakage if a database snapshot is inspected. Using URL fragments ensures that browser requests never transmit the raw token in HTTP headers or proxy access logs.

Timing attack protection is established through an execution time floor rather than variable dummy calculations, guaranteeing indistinguishable response times between registered and unregistered queries. A 60 second silent cooldown per email protects against mailbox flooding while keeping valid reset tokens intact. Finally, integrating with the `token_version` mechanism established in spec 0039 guarantees that any credential change instantly invalidates all active sessions across all devices.
