# AthleData: evidence, OAuth and MCP contract

Implementation update, 2026-10-28: backend discovery, standalone authorization code/S256 flow, encrypted token storage, refresh/disconnect, official MCP SDK and schema-pinned capability gates are implemented and fixture-tested. The evidence ledger below records the original research; live provider findings remain unchanged. No real user account was connected, OAuth client registered, provider tool invoked or workout sent. The outbound proxy still blocks discovery. See [PRODUCTION_SETUP.md](PRODUCTION_SETUP.md) for the implemented subset, limitations and exact external setup actions. The remainder of this document is the target design, not a claim all its mechanisms are implemented.

## Evidence ledger

| Claim / probe | Observation | Confidence / consequence |
| --- | --- | --- |
| MCP address | User supplies `https://mcp.athletedata.health/mcp` (note spelling `athletedata` in hostname). | Known requested address, not confirmed live service behavior. |
| Unauthenticated GET with MCP Accept header | Both normal and approved escalated curl returned `CONNECT tunnel failed, response 403`, proxy `server: envoy`. | Verified environment egress denial before target TLS/HTTP; not an AthleData 403, not evidence of missing account permission. |
| OAuth metadata, issuer, scopes, registration, refresh, revocation | Could not reach the resource, so none discovered. | Unknown. No authorization/token/registration endpoints may be hard-coded from guesses. |
| AthleData/Garmin/cloud OAuth environment names | Name-only inspection found no matching exported variable names. | Does not prove account credentials are unavailable elsewhere; no values inspected. No credentials requested in chat. |
| `push_workout_to_watch`, `update_workout_on_watch`, `delete_workout_from_watch` | Candidate names supplied by the user. | Unverified names, schemas, permissions and semantics. |
| Activity/detail/recovery tools | Prior specification suggests `garmin_get_activities`, `garmin_get_activity_file`, `get_activity_detail`, `get_analytics_summary`, `get_planned_workouts`. | Candidate discovery hints only. No schema invented. |
| Official SDK | Official repository README describes stable split v2 packages; npm `@modelcontextprotocol/client/latest` returned 2.4.0, Node ≥20, `workerd` shim and `validators/cf-worker` exports. | Verified published metadata; not a tested Worker bundle or provider connection. |
| OAuth standard | Official MCP 2025-11-25 authorization source retrieved. Defines resource metadata, AS discovery, S256 PKCE, resource audience, optional registration mechanisms. | Verified standard, not provider compliance. SDK README references newer 2026-07-28 protocol; direct dated source path tried returned 404. Verify negotiated protocol and its current auth requirements in Phase 3. |

No authenticated capability is verified. Successful access through a ChatGPT/Codex connector would not authorize ENDURANCE OS and must not be used as its token source.

## Authoritative sources consulted

Retrieved successfully 2026-10-28:

- [Official SDK README](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md), via `raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`.
- [Official npm client metadata](https://registry.npmjs.org/@modelcontextprotocol/client/latest).
- [MCP authorization specification, 2025-11-25](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/authorization.mdx).
- [Cloudflare Vite plugin source docs](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/vite-plugin/index.mdx): local `workerd`, bindings, SPA and backend build support.
- [D1 database API source docs](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/d1/worker-api/d1-database.mdx): transactional batch and Sessions API.
- [D1 limits](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/d1/platform/limits.mdx) and [pricing model](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/d1/platform/pricing.mdx).

Direct `developers.cloudflare.com` and `modelcontextprotocol.io` requests also encountered proxy CONNECT 403. A guessed SDK `docs/client/transports.md` path returned 404; it is not evidence about transport support. Sources on moving branches must be rechecked and release/commit identifiers recorded during implementation. No provider documentation was reachable in this task.

## Network gate

Environment settings need access to `mcp.athletedata.health` for research and runtime testing. Discovered authorization-server and registration hosts may need additional access after validation. Official documentation hosts are useful for follow-up. Do not replace an unknown allowlist or disable TLS verification. No network settings were changed here. A fresh attempt after settings change must distinguish proxy failure, resource 401 challenge, provider 403, and protocol errors.

## Independent server-side authorization

1. An authenticated owner selects “Koble til AthleData”. POST `/api/v1/integrations/athledata/connect` with app CSRF token. Select read-only intent initially; an explicit send action can request write consent later.
2. Backend probes the supplied MCP resource with the chosen SDK transport. Parse any `WWW-Authenticate` resource metadata challenge. If absent, use standards-defined RFC 9728 path-aware then root well-known discovery. These are probe candidates, not claimed provider endpoints.
3. Validate HTTPS metadata, resource identity, issuer and advertised AS candidates. Choose an explicitly trusted issuer. Discover RFC 8414/OIDC metadata with path-aware ordering. Store metadata hash/time and approved hosts; never accept a frontend-provided issuer or arbitrary URL.
4. Require supported authorization-code flow and advertised S256 PKCE. Establish a real registration route: pre-registered confidential client is preferred; use Client ID Metadata Documents or RFC 7591 dynamic registration only if the AS advertises/permits them. A public client with PKCE is acceptable only if actually supported; backend token storage still applies. Do not silently downgrade to password grant, unverified tokens or scraped Garmin credentials.
5. Use exact registered HTTPS callback `/api/v1/integrations/athledata/callback`. For local testing use a provider-permitted local callback or dedicated HTTPS staging callback; no assumption that localhost is allowed. Registration requires provider acceptance before launch.
6. Generate 256-bit random `state`, S256 verifier/challenge and a 10-minute single-use `oauth_transactions` row bound to current session and issuer. Store state hash and encrypted verifier. Store only a relative safe return path. Bind intended resource/scopes/redirect URI to the transaction. PKCE verifier never goes to the SPA.
7. Redirect to the discovered authorization endpoint. Include resource indicator for the MCP resource in authorization and token requests as required by the applicable spec. Determine scopes from verified metadata/challenge and capability requirements: `mcp:read` / `mcp:write` are hypotheses, not constants. Do not request all supported scopes blindly. Step-up consent preserves relevant already-granted scopes.
8. Callback validates state, original live session, issuer where supported, expiry, exact redirect, and atomic single consumption before exchanging the code at the discovered token endpoint. A timed-out exchange requires restarting consent, not replaying a possibly consumed code. If Access/session expired, restart connect after sign-in. Do not log the callback query.
9. Validate token response shape, audience/resource binding and required grants; opaque access tokens need not be JWTs. Encrypt tokens in D1, update grant version, clear transient PKCE data. Redirect to a clean settings URL with only an outcome code. Provider tokens never enter browser storage, HTML, URLs returned to the app, or query caches.

Metadata endpoints may advertise cross-origin AS services: permit only reviewed HTTPS hostnames, no userinfo, IP literals, loopback/private/link-local destinations or unrestricted redirects. Limit metadata size/time/redirect count. If DNS/private-address protection cannot be enforced reliably in the runtime, require configured exact endpoint allowlists after discovery rather than arbitrary fetch.

## Refresh, disconnect and reconnect

Access expiry uses provider lifetime with a short safety margin (60 seconds), not a guessed fixed duration. No refresh token means interactive reconnect when expired. A 401 permits one refresh/re-auth attempt for a read; write retry still follows ambiguity rules. `invalid_grant` marks `reauth_required` and pauses operations.

Serialize refresh with an integration-scoped D1 lease and credential version CAS. Refresh rotation replaces ciphertext atomically; never overwrite a newer token set. A refresh request that might have consumed a rotating refresh token but whose response is lost enters `reauth_required` unless the provider documents a safe recovery mechanism. Reusing the old refresh token blindly can revoke the grant. Process-local locks are insufficient across Worker instances.

Disconnect first blocks new calls and cancels queued operations, waits for/flags any already-dispatched operation, then attempts discovered revocation if supported. A short-lived encrypted revocation operation may retain only the token needed for that attempt, at most 24 hours. Clear active credentials and all MCP session material. If revocation is unavailable or fails, clearly instruct the owner to revoke in the provider account; local disconnect cannot promise remote invalidation. Imported history remains until the owner deletes it. Reconnect verifies the provider account identity where available; an account change creates a new account namespace and must not reuse old Garmin mappings. If identity cannot be verified, require explicit owner confirmation before any write.

## MCP client and adapter design

Use the official client with Streamable HTTP if supported by the real server. Do not implement an ad hoc JSON-RPC transport or use stdio/server/Node HTTP imports in Workers. Negotiate protocol via `initialize`, retain server capabilities, send initialized notification, honor transport/session headers and list pagination through the SDK. Handle HTTP errors, JSON-RPC errors and tool results with `isError` independently; an HTTP 200 is not write success.

Phase 3 bundle test must resolve workerd exports, exercise Streams/fetch/AbortSignal/Web Crypto and use a Workers-compatible JSON Schema validator (no dynamic `eval`/`new Function` compilation). Confirm the current SDK validator export and dependencies. Build under the selected compatibility date with minimal necessary `nodejs_compat`; no unsafe evaluation flags. SDK metadata alone cannot prove compatibility.

Discover `tools/list` after initialization and cache sanitized names, schema hashes and negotiated version per connection. Paginate until complete. Explicit adapters map verified tools to capabilities:

| Internal capability | Required provider evidence |
| --- | --- |
| `activity.list` / `activity.detail` | Stable IDs/account namespace, pagination, temporal filtering, units, update semantics, completeness. |
| `recovery.read` | Metric methods, date/time meaning, unit and historical range. |
| `workout.create` | Exact structured schema, result IDs, duplicate protection or read-back. |
| `workout.update` | Ownership constraints, full vs patch payload, same/new ID semantics, schedule migration. |
| `workout.schedule` / `reschedule` | Date/time zone, external schedule ID, whether included in create/update. |
| `workout.delete` / `unschedule` | Distinct object versus calendar deletion, already-absent semantics. |
| `workout.lookup` | Search by stable client marker/idempotency key or authoritative read-by-ID. |

Dynamic discovery is not permission to execute arbitrary tools. Capability adapters are reviewed, schema-validated and limited to owner actions or configured read imports. Tool descriptions/results are untrusted data; never execute embedded instructions. Unknown schemas disable affected capability. Read-only functionality and local planning remain available when writes are blocked. Do not send health data to a model.

Instantiate short-lived clients per bounded job; close transports when finished. MCP transport session IDs are not OAuth sessions. If durable provider session continuity is required, encrypt its ID and handle expiry/reinitialization; verify server policy. Do not run long-lived SSE in Cron or assume session state survives Worker restarts. A protocol/session retry can be safe for reads but must not automatically replay an ambiguous write.

## Verification gates before dependent implementation

| Gate | Test / evidence needed | Blocks |
| --- | --- | --- |
| A1 reachability | Actual resource response and metadata, with timestamp and sanitized headers | Live OAuth and MCP testing |
| A2 standalone client | Successful registration, exact callback, S256 code exchange, issuer/resource validation, granted scopes | Production connection |
| A3 token lifecycle | Expiry, supported refresh/rotation, denial/reconnect, disconnect/revocation semantics | Unattended imports |
| A4 Worker transport | Real workerd bundle and authenticated initialize/list/read with limits | Integration release |
| A5 writes | Schemas and create/update/reschedule/delete tests, both same-ID and replacement-ID behavior | Garmin write features |
| A6 read-back/idempotency | Provider duplicate prevention or reliable reconciliation, injected timeout response loss | Safe automatic write retry |
| A7 device | Garmin Connect visibility, supported Fenix 6 representation and owner device confirmation | Claim of watch delivery |
| A8 import | Completed activity identity, pagination/late update, actual fields, any planned-ID link | Reliable matching/analytics |

Capture sanitized contract fixtures, not tokens or real athlete payloads. A small athlete-authorized live workout is required for A5–A8 in a future implementation phase. If registration is partner-only, obtain provider authorization; do not emulate a privileged ChatGPT client. If write tools are absent, continue local calendar/read integration and label Garmin delivery unavailable. A downloadable workout file can be investigated later as a fallback, but does not fulfill the requested automatic roundtrip.
