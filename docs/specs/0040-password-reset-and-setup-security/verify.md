# Verify: Password Reset and Initial Account Password Setup Security · spec 0040 · updated 2026-11-09
_Steps derived from spec 0040 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Open `/login`, click Forgot Password, enter any email, submit → generic confirmation message appears without revealing account existence → AC-7
- [ ] Check inbox for generated magic link → link targets `/auth/setup-password#token=...` with token in URL fragment → AC-15, AC-20
- [ ] Open magic link in browser → URL fragment scrubs immediately on mount, referrer meta set to no-referrer, token remains pending → AC-18, AC-22
- [ ] Mount setup link for newly provisioned user → page title shows Set Up Your Password with welcome instructions and activate action → AC-20
- [ ] Mount reset link for active user → page title shows Reset Your Password with security instructions and reset action → AC-20
- [ ] Open link past expiration (24 hours for setup, 30 minutes for reset) → interface shows expired notice and blocks submission → AC-1, AC-2, AC-10, AC-11
- [ ] Submit weak password lacking complexity → form checklist and server validation return error feedback → AC-17
- [ ] Submit valid password → password updates, token transitions to accepted, duplicate submission rejected with 400, no automatic login occurs → AC-3, AC-14, AC-16
- [ ] Reset password while active session exists on another device → prior session rejected on next request due to incremented token_version → AC-13
- [ ] Trigger administrative reinvite from users list → prior pending setup tokens for user revoked and older outbox delivery jobs cancelled → AC-4

## Commands
- [ ] `.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_password_reset_and_setup_security.py"` → 19 automated tests pass covering all security criteria → AC-1 through AC-22
- [ ] `.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_user_invitation_resilience.py"` → 12 invitation resilience tests pass → AC-1 through AC-6, AC-19
- [ ] `.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_migrations.py"` → database migrations apply idempotently including migration 0041 → AC-21

## Acceptance-criteria coverage
- AC-1 covered by test_ac1_ac2_setup_token_expiry_rejection · AC-2 covered by test_ac1_ac2_setup_token_expiry_rejection · AC-3 covered by test_ac3_setup_token_single_use · AC-4 covered by test_ac4_reinvite_revokes_previous_setup_tokens · AC-5 covered by test_ac5_ineligible_accounts_blocked · AC-6 covered by test_ac6_setup_token_rejected_at_reset_endpoint · AC-7 covered by test_ac7_forgot_password_anti_enumeration_generic_response · AC-8 covered by test_ac8_forgot_password_dual_rate_limiting · AC-9 covered by test_ac9_silent_cooldown_and_time_floor · AC-10 covered by test_ac10_ac11_reset_token_expiry_and_invalidation · AC-11 covered by test_ac10_ac11_reset_token_expiry_and_invalidation · AC-12 covered by test_ac12_reset_token_rejected_at_setup_endpoint · AC-13 covered by test_ac13_password_reset_session_revocation_token_version · AC-14 covered by test_ac14_no_auto_login_on_completion · AC-15 covered by test_ac15_entropy_and_crypto_hygiene · AC-16 covered by test_ac16_atomic_token_consumption_concurrency · AC-17 covered by test_ac17_three_phase_compensation_saga_rollback · AC-18 covered by test_ac18_plaintext_secrets_invariant · AC-19 covered by test_ac19_email_dispatcher_templates · AC-20 covered by SetPasswordPage mount validation and dynamic purpose adaptation · AC-21 covered by test_ac21_schema_migration_backward_compatibility · AC-22 covered by test_ac20_ac22_token_validation_endpoint
