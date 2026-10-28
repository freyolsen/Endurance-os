# Security and privacy requirements

Threat model: one private athlete account with sensitive health/training data. Protect against unauthorized browser/API access, stolen sessions, CSRF, XSS, exposed provider tokens, malicious provider metadata/tool output, duplicate remote side effects and accidental data loss. Assume a lost unlocked device can expose opted-in offline data; state that limitation honestly.

## Identity and session boundary

Production uses Cloudflare Access backed by a configured owner identity provider with MFA where available. Verify Access JWT signature against the configured team's trusted JWKS, issuer, audience, algorithm, expiry and owner subject; do not trust an arbitrary `Cf-Access-*` header. JWKS URL is configured, not accepted from JWT `jku`. Owner identity is a fixed issuer+subject, not a user-supplied email or “first visitor wins”. Separate Access applications/audiences for staging/production.

Worker performs identity verification for every private request, then verifies its own opaque D1 app session. There is no alternate public signup/password endpoint. Session bootstrap requires valid owner JWT and same-origin request, issues 256-bit random opaque token and independent CSRF secret; store only hashes. `__Host-eos_session`: Secure, HttpOnly, Path=/, SameSite=Lax, no Domain. Callback top-level GET is compatible with Lax but must also verify stored OAuth state/session. Rotate on authentication, privilege change and suspected compromise.

App session absolute expiry 24 hours, idle expiry 8 hours, last-seen writes throttled to once per 15 minutes. Both Access and app sessions must be valid online; app lifetime does not extend Access authentication. Destructive export/delete/disconnect requires owner authentication within 10 minutes; use the supported Access reauthentication flow and trustworthy auth-time claim. If freshness cannot be proven, do not silently treat a new app cookie as reauthentication: this is a Phase 1 security gate. Logout revokes app session and clears local data; optionally complete the configured Access logout so a shared browser does not silently recreate a session.

Disable or equally protect `workers.dev`, preview URLs and any alternate hostname; test direct-origin bypass. Serve the app on one approved origin. Asset routing must not bypass API auth: configure worker-first handling for `/api/*`; permit public hashed shell/icons/manifest only because they contain no personal data. No SSR embeds private state. A route-path or SPA fallback must never turn `/api` errors into public cached HTML.

Local development may inject a fixed mock owner ONLY in a separate local-only binding/configuration served on loopback with local D1. The production build/config validation must fail if that identity bypass is enabled; an HTTP header/body/query cannot activate it. Production and live staging use real Access. Do not introduce a default password or hard-coded auth secret for convenience.

## Request and browser protections

- Exact same-origin checks plus session-bound CSRF header on mutations; reject absent/foreign Origin for browser writes, non-JSON form posts and permissive CORS. Bootstrap uses same-origin non-simple request validation; callback is the documented exception protected by state/PKCE.
- Authorize each endpoint and object against owner and live status. Cron has no public dispatch endpoint; scheduled handler uses bindings and due records, not browser cookies.
- Parameterized SQL, strict shared input schemas, body/AST limits, bounded pagination, validated dates/units, optimistic concurrency. Never interpolate client sort fields into SQL without a fixed allowlist.
- CSP: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; form-action limited to self/verified auth needs; image/style directives restricted to actual usage. Avoid unsafe-inline scripts and raw HTML rendering of provider content. Use style mechanisms compatible with the chosen UI library and test CSP rather than broadly disabling it.
- HSTS on production HTTPS, Referrer-Policy: no-referrer on auth flows (strict-origin-when-cross-origin elsewhere if needed), X-Content-Type-Options: nosniff, conservative Permissions-Policy (camera/mic/geolocation off unless a later feature explicitly requires them).
- No credential-bearing URLs in logs/history; immediately redirect successful OAuth callback to a clean relative route. Do not embed provider authorization URLs into analytics or persistent browser cache.

## Rate limits and abuse

Prefer Cloudflare platform request controls where available, plus app-level atomic counters. Session bootstrap 10 attempts/10 min per HMAC-IP group and 30/hour globally; normal API 120 requests/min per owner; expensive manual imports ≤1/min and 12/hour with coalescing; OAuth initiation 5/10 min; privacy actions 3/hour. Values are initial limits to test against real usage, not provider quotas. Limits return 429/Retry-After and do not consume external calls. Distributed in-memory counters are not sufficient; use D1 conditional counters or an available platform rate-limit binding. Bound counter retention to avoid a denial-of-service database growth path.

## Provider secrets and OAuth

Use independent Authorization Code + S256 PKCE with verified metadata/issuer/resource and registration. A Codex/ChatGPT connector grants no standalone authority. Details and failure gates are in [ATHLEDATA_INTEGRATION.md](ATHLEDATA_INTEGRATION.md).

Cloudflare secret bindings hold token encryption key ring and any statically registered client secret. Suggested deployment names: `TOKEN_ENCRYPTION_KEY_V1`, `RATE_LIMIT_HMAC_KEY`, optional `ATHLEDATA_CLIENT_SECRET`; ordinary configuration: `APP_ORIGIN`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_ACCESS_SUB`, `ATHLEDATA_RESOURCE_URL`, optional registered client ID. Never use `VITE_` for secrets or commit `.dev.vars`. Cloud onboarding proxy-secret bindings are not automatically usable as local raw encryption keys; provision actual Worker secrets through the platform's secure secret mechanism at deployment.

Token envelope encryption: Web Crypto AES-256-GCM, cryptographically random 96-bit nonce per encryption, associated data includes integration ID + owner + credential purpose + version. Store base64 nonce/ciphertext and nonsecret key ID. Separate payload version from key version. Rotation: add new secret key, reencrypt bounded rows, verify decryptability, then retire old key after backup retention policy permits. Never reuse nonce/key pair, log plaintext, put tokens in operation JSON except narrowly encrypted temporary revocation envelope, or return them to frontend. PKCE verifier and sensitive MCP transport sessions are encrypted too.

Serialize refresh and external writes, honor token audience and exact endpoints; no token passthrough to another host. Unsupported refresh/revocation is visible. Disconnect immediately prevents new calls, but cannot recall an already-dispatched provider operation. Unknown refresh outcomes require reconnect rather than repeated token replay. Revocation credentials are deleted after attempt/24h expiry; preserve only a redacted outcome.

## Untrusted provider input and SSRF

Only configured resource plus reviewed discovered HTTPS issuer/endpoints. Reject IP literals/private/link-local destinations, userinfo, nonstandard schemes and unreviewed redirect targets; strip credentials when following any permitted cross-origin redirect. Do not turn the app into an arbitrary MCP proxy. Fetch with deadlines, size limits and content-type validation. Large FIT downloads require separate approved-host handling. Tool schema/name changes disable the adapter until reviewed. Tool output strings are untrusted text, not instructions; never render HTML or invoke additional tools because a result asks to do so.

## Data minimization, logs and exports

No external analytics, ad trackers or remote fonts required. Operational logs contain request ID, route template, duration, status, safe error category, operation ID; never cookie, OAuth code, Authorization header, full provider URL/query, health payload, notes or GPS. Redact SDK/Cloudflare error output before persistence. Retain operational details 30 days and redacted sync history 90 days; essential audit/identity links remain with the data until deletion. Separate debug fixtures use synthetic values labeled test-only.

Export includes plans/revisions, observations/provenance, links, goals, settings, feedback and calculated metrics/methods in versioned JSON plus optional flattened CSV. It excludes credentials, cookies, PKCE, encryption keys, raw access tokens and rate-limit internals. Authentication required for each download chunk, no public URLs, no-store, 24-hour job expiry. Prevent CSV formula injection in string cells. Capture a consistent export manifest of immutable record revisions and a watermark; while building the manifest, serialize owner mutations/import commits behind a short export snapshot guard or use a verified database export mechanism. Do not claim a multi-request database transaction. Test large exports and interrupted download resumption. If retained raw files are later added, document scope and expiry separately.

## Deletion and recovery

Owner explicitly selects local records, imported data/provider connection, or all athlete data; fresh authentication and typed confirmation for full purge. Separate choice for owned Garmin workout removal; local deletion cannot promise third-party deletion. Phase 8 defines exact UI confirmation and tests. Disconnect, stop auto-import, cancel queued work and resolve/flag in-flight ambiguity before purge. Store only the minimal durable job/progress needed for resumable child-first D1 deletion. Workouts use tombstones until external operations settle; purge removes history/observations/links, invalidates analytics and expires sessions. Keep owner security configuration until account closure is separately confirmed.

Cloudflare backups/Time Travel can retain deleted data for the service's retention window (retrieved D1 docs: 7 days Free / 30 days Paid). Explain this limit; immediate logical deletion is not guaranteed immediate backup erasure. Do not retain exported private backups forever. Revoke provider credentials and rotate keys after compromise; restoring a database must not reactivate old sessions, old OAuth grants or queued remote writes. Restore procedure disables Cron/writes, expires all sessions, marks connections reauth-required, reconciles external mappings, then explicitly resumes. Restoration is tested on isolated staging/local data, never an unattended production reset.

Offline calendar/drafts are opt-in device copies, excluded from service-worker API caching. Logout purges them, but remote revocation cannot erase an offline device immediately. Device lock and explicit local-cache disclosure are required. Tokens are never stored in localStorage, IndexedDB or service-worker caches.

## Required security tests

JWT wrong issuer/audience/signature/subject/expiry, forged Access headers, alternate-host bypass, missing/expired/revoked app sessions, no credentials in build/assets/logs, cross-origin and missing-Origin writes, callback replay/state mismatch/session mismatch, PKCE absence, malicious metadata redirects, provider-token audience leakage, refresh race/rotation loss, IDOR, SQL injection, stored-XSS provider text, payload limits, distributed rate limits, session fixation, offline logout, export authorization/chunk expiry/CSV injection, delete interruption and backup restore without remote replay. Use a real workerd integration suite plus staging identity/provider tests; fixtures alone cannot validate Access policy or provider OAuth.
