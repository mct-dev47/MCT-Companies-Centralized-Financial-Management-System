# Review, dev, 2026-11-10

**Reviewed by**: Gemini 3.8 Pro (author on Gemini 3.8 Flash)
**Scope**: 10 files, uncommitted
**Verdict**: Changes requested

## Summary

This change implements comprehensive security hardening across the backend: exact trusted CORS origin enforcement rejecting wildcard origins when credentials are enabled, CSRF origin and custom header verification across cookie-accepting authentication endpoints, strict Content Security Policy directives, centralized SSRF prevention for external resource URLs, zero-leakage database error handling via `SQLAlchemyError`, and environment-gated admin protection for API documentation. The design and security posture are substantially upgraded, but three major issues must be resolved before merging: the Content Security Policy blocks Swagger UI/ReDoc CDN assets, CORS `allow_headers` omits required frontend application headers (`Idempotency-Key`, `X-User-Role`, `X-User-Name`), and `protected_swagger_ui` fails to pass authorization tokens down to the OpenAPI definition URL when accessed via Bearer header.

## Major

### 🟠 Content Security Policy blocks Swagger UI and ReDoc assets, `backend/app/main.py:111-122`
**Problem**: The `Content-Security-Policy` header restricts `script-src` to `'self' 'unsafe-inline'` and `style-src` to `'self' 'unsafe-inline' https://fonts.googleapis.com`. FastAPI's `get_swagger_ui_html` and `get_redoc_html` load bundle scripts and stylesheets from `https://cdn.jsdelivr.net`.
**Why it matters**: In both development and production (when authenticated as an administrator), accessing `/docs` or `/redoc` in any browser results in a blank, broken page because the browser refuses to execute JavaScript and load CSS from `https://cdn.jsdelivr.net` due to CSP violation.
**Suggested fix**: Include `https://cdn.jsdelivr.net` in the `script-src` and `style-src` CSP directives (or conditionally exempt or customize the CSP on documentation routes).

### 🟠 CORS `allow_headers` omits active frontend application headers, `backend/app/main.py:132-140`
**Problem**: `EXPLICIT_CORS_HEADERS` restricts allowed request headers to `["Authorization", "Content-Type", "Accept", "Origin", "X-Request-ID", "X-MCT-CSRF", "X-Requested-With"]`. However, multiple active frontend services transmit additional custom headers:
- `Idempotency-Key` (in `frontend/src/services/pettyCashService.ts:599, 613, 627, 641, 655, 669, 727` for finalize, reimbursement, transfer, confirm, cancel, reversal, and settlement actions)
- `X-User-Role` (in `frontend/src/services/bankService.ts:148`, `loanService.ts:416, 731, 786`, `notificationService.ts:160`, and `pettyCashService.ts:311`)
- `X-User-Name` (in `frontend/src/services/loanService.ts:415, 730, 785` and `pettyCashService.ts:310`)
**Why it matters**: Any cross-origin request using these endpoints (e.g. Vite dev client on `localhost:5173` or a production web app on a separate domain/subdomain) triggers a browser CORS preflight (`OPTIONS`). Because `CORSMiddleware` rejects unlisted headers, the browser aborts the request, causing petty cash workflow transitions, settlements, bank operations, and notifications to fail.
**Suggested fix**: Add `"Idempotency-Key"`, `"X-User-Role"`, and `"X-User-Name"` to `EXPLICIT_CORS_HEADERS` in `backend/app/main.py`.

### 🟠 `protected_swagger_ui` fails to pass token to OpenAPI URL when authenticated via header, `backend/app/main.py:72-85`
**Problem**: In `protected_swagger_ui` and `protected_redoc`, the application only inspects `token = request.query_params.get("token")` when appending credentials to `openapi_url`. If an admin authenticates via standard HTTP `Authorization: Bearer <token>`, `token` is `None`, so `openapi_url` is constructed without credentials (`/api/v1/openapi.json`).
**Why it matters**: The browser's Swagger UI client performs a client-side fetch to `/api/v1/openapi.json` without headers. Because the query token is omitted, `_get_admin_for_docs` rejects the OpenAPI schema request with HTTP 401 Unauthorized, rendering Swagger UI unable to load and parse the API specification.
**Suggested fix**: In `protected_swagger_ui` and `protected_redoc`, extract the bearer token from `request.headers.get("authorization")` if absent in query parameters, and append it to `openapi_url`.

## Minor

### 🟡 Copy-paste error returns `"Invalid deposit parameters."` on withdrawal, `backend/app/api/v1/endpoints/bank_accounts.py:250`
**Problem**: In `withdraw_from_bank_account`, the sanitized error message in the `ValueError` catch block is set to `"Invalid deposit parameters."` instead of `"Invalid withdrawal parameters."`.
**Why it matters**: Confuses API consumers and frontend users when validation on a bank withdrawal fails.
**Suggested fix**: Update the message on line 250 to `"Invalid withdrawal parameters."`.

### 🟡 Broad single-character sanitization heuristic in `bank_accounts.py` masks legitimate validation messages, `backend/app/api/v1/endpoints/bank_accounts.py:139, 212, 249`
**Problem**: The condition `any(token in msg.lower() for token in [..., "/", "\\"])` matches any forward slash or backslash.
**Why it matters**: Legitimate business error messages containing slashes (e.g. date format `"MM/DD/YYYY"`, `"N/A"`, or transfer descriptions with slashes) trigger the mask and return a generic error, obscuring actionable user feedback.
**Suggested fix**: Replace single-character tokens with regex targeting actual path sequences (`r"[/\\].+[/\\]."`) or SQL keywords.

### 🟡 Synchronous blocking DNS resolution in Pydantic validator without explicit timeout, `backend/app/core/ssrf.py:68`
**Problem**: `validate_safe_url` calls `socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)` synchronously inside Pydantic field validators on schema deserialization.
**Why it matters**: If a user submits a URL targeting an unresolvable or malicious unresponsive DNS nameserver, the worker thread blocks for the OS resolver timeout (typically 5 to 30 seconds), creating potential worker thread exhaustion under concurrent submissions.
**Suggested fix**: Wrap DNS resolution in an async executor or thread pool with an explicit short timeout (e.g., 2.0 seconds).

### 🟡 Missing SSRF validation on user profile photo URL, `backend/app/schemas/user.py:19, 62`
**Problem**: While `logo_url` in `CompanyBase` and `receipt_url` in `PettyCashTopUpCreate` have SSRF validation, `photo_url` in `UserBase` and `UserUpdate` remains unvalidated.
**Why it matters**: A user can supply an internal IP or cloud metadata URL as their profile picture, which could trigger unintended client or server requests when accessed.
**Suggested fix**: Add `@field_validator("photo_url")` calling `validate_safe_url(v, allow_localhost_dev=True)` in `app/schemas/user.py`.

### 🟡 Case-sensitive origin comparison in CSRF verification, `backend/app/services/session_service.py:124-128`
**Problem**: `_normalize_origin` reconstructs the origin string via `f"{parsed.scheme}://{parsed.netloc}"` without lowercasing scheme and netloc before membership checking in `trusted_origins`.
**Why it matters**: Proxies or clients transmitting mixed-case hostnames (e.g., `http://Localhost:5173`) will fail CSRF origin validation.
**Suggested fix**: Normalize with `f"{parsed.scheme.lower()}://{parsed.netloc.lower()}".rstrip("/")`.

## Nits

- ⚪ `backend/app/main.py:88-94`, `protected_openapi` computes the OpenAPI dictionary on every request via `get_openapi(...)` rather than caching it in `app.openapi_schema`.
- ⚪ `backend/app/core/config.py:147-149`, `assemble_cors_origins` checks `orig.startswith("http://")` and strips trailing slash, but does not parse URL components to reject invalid path segments (e.g. `https://example.com/api`).

## Strengths

- **Dual-layer CSRF Defense**: Enforces custom header presence (`X-MCT-CSRF: 1` or `X-Requested-With: XMLHttpRequest`) alongside strict `Origin` / `Referer` matching against configured CORS origins for all cookie-consuming state changes.
- **Robust Database Error Interception**: The dedicated `SQLAlchemyError` handler cleanly intercepts database exceptions, preventing SQL queries, table schemas, or driver connection errors from leaking to callers in production while providing request correlation tracking.
- **Thorough SSRF IP Filtering**: `is_ip_blocked` validates both IPv4 and IPv6 loopback, RFC 1918 private ranges, link-local, multicast, cloud metadata (`169.254.169.254`), and reserved addresses.
- **Targeted Test Coverage**: 21 new automated tests in `test_security_hardening.py` provide clear verification for CORS, CSRF, CSP, SSRF, and exception handling logic.

## Resolution & Verification (Post-Review Update)

All findings have been addressed and verified with passing automated tests:
1. **CSP Swagger/ReDoc Asset Blocking (Resolved)**: Added `https://cdn.jsdelivr.net` to `script-src` and `style-src` in `main.py`.
2. **Missing Frontend CORS Headers (Resolved)**: Added `"Idempotency-Key"`, `"X-User-Role"`, and `"X-User-Name"` to `EXPLICIT_CORS_HEADERS` in `main.py`.
3. **Bearer Token Propagation to OpenAPI URL (Resolved)**: Updated `protected_swagger_ui` and `protected_redoc` to extract `token` from `Authorization: Bearer <token>` header and append to `openapi_url`. Cached schema in `protected_openapi`.
4. **Bank Withdrawal Message (Resolved)**: Corrected sanitized fallback error on withdrawal from `"Invalid deposit parameters."` to `"Invalid withdrawal parameters."`.
5. **Path Heuristic in Bank Accounts (Resolved)**: Replaced single-character slash matching with targeted `_sanitize_value_error` checking specific sensitive tokens and multi-segment path patterns.
6. **DNS Timeout Bounding (Resolved)**: Wrapped `socket.getaddrinfo` in a thread pool executor with a 2.5s timeout.
7. **User Photo URL SSRF Validation (Resolved)**: Added `@field_validator("photo_url")` calling `validate_safe_url` in `UserBase` and `UserUpdate`.
8. **Case-Insensitive Origin Matching (Resolved)**: Normalized scheme and netloc to lowercase in `_normalize_origin`.

All 22 unit and regression tests in `test_security_hardening.py` and 15 tests in `test_security_checklist.py` pass.

