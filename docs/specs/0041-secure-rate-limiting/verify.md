# Verify: secure rate limiting, spec 0041, updated 2026-11-09
_Steps derived from spec 0041 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Enter wrong password 4 times on SignInForm → Failure alert displays attempt count without lockout → AC-1
- [ ] Enter wrong password 5th time on SignInForm → Live countdown timer displays 15:00 and submit button locks → AC-2, AC-19, AC-34
- [ ] Refresh browser during active login lockout → Timer restores exact remaining seconds from server status endpoint → AC-9
- [ ] Wait for login timer expiration → Submit button unlocks and login succeeds with valid credentials → AC-4, AC-7
- [ ] Click Resend OTP immediately after challenge creation → Toast shows cooldown message with MM:SS countdown → AC-11, AC-19
- [ ] Wait 120 seconds and click Resend OTP → Fresh verification code arrives and cooldown restarts at 02:00 → AC-12
- [ ] Trigger 5 successful resends then request 6th → Modal transitions to 15 minute lockout countdown and button disables → AC-13, AC-19
- [ ] Refresh browser during OTP lockout → Lockout timer restores from database and resend remains locked → AC-15
- [ ] Submit invalid OTP code → Generic user friendly error displays without stack trace or technical leakage → AC-29, AC-32
- [ ] Submit valid OTP code → Verification succeeds and user enters app without double redemption → AC-25, AC-28

## Commands
- [x] `& "C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe" -m pytest backend/tests/test_secure_rate_limiting.py -v` → All tests pass cleanly → AC-1 through AC-35
- [x] `& "C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe" -m pytest backend/tests/test_migrations.py -v` → Migration 0042 applies forward and idempotent → AC-22, AC-25
- [x] Inspect database table `login_otp_challenges` → `otp_hmac` column contains 64 character hex digests with zero plaintext codes → AC-26
- [x] Send rapid burst of 125 requests to general API endpoint → Requests beyond 120 return HTTP 429 with `Retry-After` header → AC-20
- [x] Send simulated request with spoofed `X-Forwarded-For` from untrusted socket → Server extracts socket IP instead of spoofed client header → AC-21
- [x] Trigger server error on API route → Response returns uniform JSON with error `code` and `request_id` without tracebacks → AC-29, AC-30, AC-33, AC-35

## Acceptance criteria coverage
- AC-1: Covered by test_ac1 and manual 4 failure sign in step
- AC-2: Covered by test_ac2 and manual 5th failure lockout step
- AC-3: Covered by test_ac3 and automated HTTP 429 verification
- AC-4: Covered by test_ac4 and post lockout login step
- AC-5: Covered by test_ac5 rotating email IP rate limit check
- AC-6: Covered by test_ac6 account level progressive delay
- AC-7: Covered by test_ac7 successful sign in counter clearance
- AC-8: Covered by test_ac8 atomic database row locking
- AC-9: Covered by test_ac9 and page refresh restoration step
- AC-10: Covered by test_ac10 uniform timing and responses
- AC-11: Covered by test_ac11 and 120s cooldown resend step
- AC-12: Covered by test_ac12 and successful OTP resend step
- AC-13: Covered by test_ac13 and 6th resend lockout step
- AC-14: Covered by test_ac14 rejected resend validation
- AC-15: Covered by test_ac15 and OTP lockout refresh persistence
- AC-16: Covered by test_ac16 rotating identity threshold check
- AC-17: Covered by test_ac17 concurrent resend cap check
- AC-18: Covered by test_ac18 delivery failure handling
- AC-19: Covered by test_ac19 and frontend MM:SS timer verification
- AC-20: Covered by test_ac20 and API rate limiting middleware
- AC-21: Covered by test_ac21 trusted proxy resolver
- AC-22: Covered by test_ac22 database multi worker consistency
- AC-23: Covered by test_ac23 database fail closed verification
- AC-24: Covered by test_ac24 30 day audit retention pruning
- AC-25: Covered by test_ac25 and test_spec_0039 test suites
- AC-26: Covered by test_ac26 HMAC storage database verification
- AC-27: Covered by test_ac27 two phase invalidation test
- AC-28: Covered by test_ac28 atomic OTP redemption test
- AC-29: Covered by test_ac29 centralized exception handlers
- AC-30: Covered by test_ac30 log redaction verification
- AC-31: Covered by test_ac31 uniform credential responses
- AC-32: Covered by test_ac32 frontend error mapping
- AC-33: Covered by test_ac33 request correlation header check
- AC-34: Covered by test_ac34 button loading state verification
- AC-35: Covered by test_ac35 production traceback suppression

