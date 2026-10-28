# Production and provider release gates

Status: locally implemented and fixture-tested, **not deployed or live-provider verified**. No Cloudflare resource, production migration, OAuth registration or real Garmin write was performed. Do not deploy without the owner's explicit authorization. The application remains private; a successful build is not a release approval.

## 1. Cloudflare configuration — owner action required

The current environment has no authenticated Wrangler account. `npm run production:check` intentionally fails on these missing settings:

| Setting | Required value / location |
| --- | --- |
| `env.production.d1_databases[0].database_id` | Actual separate production D1 UUID, replacing the `00000000-…0002` placeholder in `wrangler.jsonc`. Never reuse the local database. |
| `env.production.vars.APP_ORIGIN` | Exact private HTTPS origin, no trailing slash/path, replacing `https://configure-your-private-domain.invalid`. |
| `ACCESS_TEAM_DOMAIN` | Access team hostname, e.g. the account's `…cloudflareaccess.com`, without `https://`. |
| `ACCESS_AUD` | Audience of the Access application protecting this exact domain. |
| `OWNER_ACCESS_SUB` | Owner's verified Access subject, not an email guessed to be a subject. |
| `AUTH_MODE` | Keep `access` in production. Development identity is compiled out of production builds. |

Authenticate to the correct Cloudflare account through a secure credential mechanism. Configure an Access application protecting the entire hostname, including assets, `/api/*`, and the OAuth callback. Permit only the owner; no bypass policy. Configure the custom domain/route explicitly. `workers_dev` and preview URLs are disabled and must remain disabled. Configure production vars in the named environment (or managed secrets where appropriate), not only in the local shell or default environment.

The proxy warning from Wrangler merely says it detected this environment's outbound proxy. It is not proof of Cloudflare authentication or valid production bindings. No exported Cloudflare setting names were present during verification; values were never logged.

### D1 checks before an authorized deployment

All three migrations apply to local workerd/D1 and pass foreign-key checks in integration tests. `0003_integrations.sql` is additive: connections, encrypted credentials, OAuth transactions, leases, durable sync operations/results/history, external ID lineage, observed activities/revisions/sources, links and cursors. Existing workout/template/profile data is preserved.

Once the correct account/database is configured, inspect remote state and obtain a backup/Time Travel recovery point before applying migrations. These commands are an operator checklist, **not executed here**:

```sh
# Read-only inspection, after authenticating and confirming the binding:
npx wrangler whoami
npx wrangler d1 migrations list endurance-os-production --remote --env production
npx wrangler d1 execute endurance-os-production --remote --env production --command 'PRAGMA foreign_key_check'

# Mutating: only after explicit authorization and recovery preparation:
npx wrangler d1 migrations apply endurance-os-production --remote --env production
```

Run `npm run production:check`, `npm run verify`, `npm run build:production` and `npm run test:pwa`. Inspect the generated Worker config: production D1 binding, `AUTH_MODE=access`, alternate hosts disabled, and 15-minute Cron present. Never deploy the default local configuration. No deploy command is part of install/test/setup scripts.

After an authorized private deployment, verify: anonymous/wrong-owner denial, valid Access login, tampered/expired/wrong-audience JWT denial, secure HttpOnly session cookie, session expiry/logout, CSRF and cross-origin mutation rejection, and direct/alternate-host denial. Local signed-JWT fixtures cover application validation; they cannot verify the deployed Access policy.

## 2. AthleData — external discovery and registration required

The supplied resource is `https://mcp.athletedata.health/mcp`. Unauthenticated probes, including an escalated retry, failed at the outbound proxy with `CONNECT 403` before reaching AthleData. Therefore the actual issuer, registration mechanism, scopes, schemas and account permissions are **unknown**. No connector credential has been reused.

Exact next actions:

1. Allow outbound access to `mcp.athletedata.health` in the cloud environment's network settings. Re-run unauthenticated resource discovery with `Accept: application/json, text/event-stream`; follow `WWW-Authenticate` resource metadata or the RFC well-known resource metadata path. Record the exact `resource` and `authorization_servers` values.
2. Review the discovered issuer and endpoint origins before allowing them in the network policy and `ATHLEDATA_ALLOWED_ORIGINS` (comma-separated exact HTTPS origins). No wildcard or arbitrary redirect forwarding is supported. The backend validates issuer equality, S256/code support and the resource audience. Multiple issuers require an explicit selection implementation, not guessing.
3. Obtain an **independent ENDURANCE OS OAuth client registration** using the provider's documented process or discovered registration endpoint. Register exactly `APP_ORIGIN + /api/v1/integrations/athledata/callback` for authorization code + S256 PKCE. The current implementation consumes a pre-registered client; automatic dynamic client registration/client-ID-metadata onboarding is not implemented. If independent clients require provider approval, that approval is a release gate.
4. Configure the settings below in the Worker, without pasting secret values into chat/Git. Select least-privilege scopes from actual metadata and provider documentation; none are hard-coded or guessed. Verify the athlete account and stable namespace before configuring `ATHLEDATA_ACCOUNT_KEY`; reconnect to that same account. Automated provider identity verification awaits its actual schema.
5. Log into ENDURANCE OS, open **Innstillinger → AthleData → Koble til AthleData**, and personally approve the provider consent screen. The existing authenticated app session must survive the callback. Authorization state is session-bound, single-use and expires after ten minutes. An expired/changed session requires restarting connection.
6. Use **Hent verktøy**. Retrieve full schemas from the protected `GET /api/v1/integrations/athledata/diagnostics` endpoint. Review the contracts/units/side effects before configuring mappings. No tools execute automatically because they appeared in discovery.

| Server setting | Purpose |
| --- | --- |
| `TOKEN_ENCRYPTION_KEY_V1` | Worker secret: base64 encoding of 32 cryptographically random bytes. Generate/store through a secret manager. AES-256-GCM; never put it in `VITE_*`, browser storage or Git. Back it up securely; replacing it without re-encryption loses credential access. |
| `ATHLEDATA_CLIENT_ID` | Independently registered client ID. |
| `ATHLEDATA_CLIENT_SECRET` | Worker secret only if the registered client requires it; supported token methods are advertised `none`, `client_secret_basic`, or `client_secret_post`. |
| `ATHLEDATA_SCOPES` | Space-separated verified least-privilege scopes, checked against discovered metadata. Missing scope metadata currently fails closed. |
| `ATHLEDATA_ALLOWED_ORIGINS` | Additional reviewed issuer/authorization/token/revocation HTTPS origins. The resource origin is already permitted. |
| `ATHLEDATA_ACCOUNT_KEY` | Stable verified account namespace, not an OAuth token. Changing it with existing history is blocked pending review/migration. |
| `ATHLEDATA_CONTRACTS_JSON` | Reviewed mappings keyed by actual MCP tool name, pinned to the discovered input/output schema hash. No working live defaults exist. |

The token key and any client secret belong in managed Worker secrets, e.g. the interactive `wrangler secret put NAME --env production` workflow after account verification. Local-only settings can use ignored `.dev.vars`; do not export them into frontend build variables. Ensure secrets go to the actual production Worker name generated by the named environment.

### Contract configuration is an engineering gate

`worker/integrations/mcp.ts` defines the validated contract shape. Each profile has `schemaHash` and `args` (provider argument name → context path). Hash is SHA-256 of `JSON.stringify({ input: tool.inputSchema, output: tool.outputSchema ?? null })` using the discovered representation. Write context is `{ definition: <saved immutable workout>, externalId: <current mapped provider ID> }`. Import context is `{ cursor }`.

Create/update profiles require a verified `resultIdPath`; update/delete must map `externalId` into the provider's current-ID argument. Import profiles require verified `itemsPath`, `originNamespace`, field mappings and optional `cursorPath`. Canonical import fields are `externalId`, optional verified `upstreamId`, `sport`, RFC3339 `startAt`, `elapsedSeconds`, `distanceM`, `avgHr`, `avgPower`, and optional `plannedExternalId`. Units must already match these names; there are no guessed conversions. Large numeric IDs must be returned as strings to avoid precision loss.

The user-supplied candidate write names are `push_workout_to_watch`, `update_workout_on_watch`, `delete_workout_from_watch`. They remain unverified. The generic field mapper is not a verified Garmin structured-workout serializer: if actual schemas require FIT/XML, enum/unit conversion, nested target translation, separate schedule operations or explicit deletion-success interpretation, implement and fixture-test that adapter before enabling the contract. Do not copy synthetic test contracts into production. Schema changes block dispatch for review.

Tokens are encrypted only in server-side D1. Refresh is serialized, version-checked and fails to reconnect-required on uncertain rotation. Disconnect removes local credentials, cancels queued writes and attempts discovered revocation; if not confirmed, revoke the app from the provider account too. Imported history remains. Automatic encryption-key rotation, provider account switching and provider-independent identity verification are not implemented.

## 3. Authorized Garmin roundtrip acceptance

No live provider/watch test has succeeded yet. Request owner authorization for the test workout and any remote delete before executing it. Then:

1. Connect independently; discover/review exact schemas and confirm the correct athlete account and Garmin permission.
2. Create one explicitly labeled test plan and send its saved revision. Record operation ID, returned `workout_id` and sent revision. Success means provider acceptance, not physical watch delivery. Owner confirms arrival on the Fenix 6.
3. Edit and send the same local workout. Verify `update_workout_on_watch` receives the current ID, not a create call. Save every replacement ID; verify only the intended workout remains remotely.
4. Perform/record the authorized activity. Manually import pages, verify stable source/activity IDs and units, and import again to prove deduplication. Verify returned planned-workout ID links to the sent immutable revision. Date/sport/duration-only candidates require explicit owner approval.
5. Check linked activity in the calendar and duration planned-versus-actual in Analyse. Imported unknown durations stay unknown and do not silently inherit manual duration. Manual records remain separate and are not double counted.
6. Test the authorized deletion against the current mapped ID; confirm provider deletion and actual device state separately. Preserve historical ID lineage and imported observations.
7. Verify token expiry/refresh, revoked consent, schema change, lost response and interrupted dispatch handling. Do not deliberately cause destructive ambiguity on a valuable workout.

Every dispatched operation is durable before the call. Timeouts/invalid results become `ambiguous`, with no blind retry; expired in-flight operations are recovered conservatively. Known returned IDs are also preserved in `sync_operations.result_json` if the final mapping transaction fails. Before-dispatch failures are blocked, not reported as sent. A 15-minute Cron recovers interrupted writes and processes at most one already owner-queued operation; it does not create plans or import automatically.

An ambiguous operation blocks further writes until evidence-based reconciliation. Automated provider read-back/reconciliation and an operator resolution UI are not implemented because the actual read-back/ownership schemas are unavailable. Do not reset an ambiguous row to queued or delete ID history to get past the gate. Retain its result/operation evidence and implement a verified reconciliation path.

Import currently handles one bounded page (maximum 100 summaries) per manual sync, saving cursor only after durable records. It preserves immutable snapshots and source identities. No complete-history coverage, per-lap/FIT detail, recovery/sleep data, fuzzy cross-provider merging, automatic backfill or advanced target-compliance analysis is claimed. Unmatched activities are visible in Analyse; the existing dashboard totals summarize linked calendar workouts, not all free activities.

## 4. iPhone/Safari release checklist

Manifest, PNG/Apple icons, safe areas, responsive layout and a static-only service worker are present. Chromium tests verify shell installation, hashed asset precache, offline cold reload and no API cache entries. App redirects/Access login HTML are rejected during shell caching. A 390px Chromium viewport is not a physical Safari test.

On the intended iPhone: verify Safari Access login and the OAuth roundtrip, Add to Home Screen and standalone launch, safe areas/keyboard/date picker, VoiceOver, offline cold launch, opted-in read-only calendar expiry/deletion, update/relaunch and logout data clearing. Verify expired Access/session behavior with the installed app. Device storage eviction and offline Access behavior may differ; do not claim offline writes or guaranteed persistence.

## Verification boundaries

`npm run production:check` is a static guard, not remote validation. Local D1 tests cannot prove remote migration state; mock OAuth/MCP tests cannot prove consent, provider behavior or device delivery. Pattern-based Git secret scans are defense in depth, not proof that every possible secret format is absent. Record actual authorized live results and update DEVELOPMENT.md before removing any release gate.
