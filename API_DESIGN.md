# Application REST API contracts

Future implementation contract, base path `/api/v1`, same-origin HTTPS, Norwegian user messages. These are ENDURANCE OS endpoints, never invented AthleData endpoints. Backend decides all ownership from session, never a body `userId`.

## Common semantics

Every private route requires a verified Access identity and live opaque app session. `POST /auth/session` bootstraps a session only from a valid configured-owner Access JWT and same-origin request. Private responses use `Cache-Control: no-store`. All mutations require exact allowed Origin, non-simple JSON content type and a session-bound `X-CSRF-Token`; OAuth callback uses state/PKCE/session binding instead. Public exceptions are a minimal health response and static install assets; see SECURITY.md.

Requests use camelCase JSON, UUID entity IDs, ISO local dates, RFC 3339 UTC instants, explicit unit-suffixed fields. Zod rejects unknown mutation properties. Default body limit 256 KiB, default page size 50, max 100; bounded 1 MiB detail/import exception only after documented need. Opaque cursor pagination with stable date+ID ordering. Date queries `[from,to]` inclusive; calendar max 93 days, analytics max 366; error 422 beyond limits.

Responses: `{"data": ..., "meta":{"requestId":"uuid","serverTime":"...Z"}}`. Lists add `{nextCursor:null|"opaque"}`. Domain DTOs never contain token ciphertext, secrets, auth headers, raw provider payloads or internal stack traces. Schema validation failures identify fields in Norwegian without reflecting submitted secret values.

Error envelope:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Økten er endret siden du åpnet den.",
    "requestId": "uuid",
    "retryable": false,
    "details": { "currentVersion": 5 }
  }
}
```

| Status | Meaning / codes |
| --- | --- |
| 400 | Malformed JSON, invalid cursor |
| 401 | `AUTH_REQUIRED`, `SESSION_EXPIRED` |
| 403 | `OWNER_REQUIRED`, `CSRF_INVALID`, `ORIGIN_DENIED` |
| 404 | Resource absent or inaccessible |
| 409 | `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `WORKOUT_LOCKED`, `SYNC_AMBIGUOUS`, `LINK_CONFLICT`, `PROPOSAL_STALE` |
| 422 | Validation, unsupported target, incomplete translateable duration/sport contract |
| 428 | Missing If-Match on versioned mutation |
| 429 | Rate limit with Retry-After |
| 502/503 | Sanitized provider failure/unavailability before a durable job was accepted |

Accepted jobs return 202 even if they later fail; inspect operation status, not request success. `201` for created local entities, `200` for reads/updated results, `204` for logout/unlink as specified. Conditional reads may use ETag in memory, but browser/shared HTTP storage of private API responses is disabled.

## Version and idempotency contract

`ETag: "v{version}"` on mutable resource reads. `If-Match` required for edits, moves, deletes, locks, links, mode changes and proposal decisions. Revision is immutable plan content; version also changes for lock/notes/status. Clients must not substitute one for the other.

Require `Idempotency-Key` (random UUID) on all POST/PUT/PATCH/DELETE commands that change state, except bootstrap/logout and single-use OAuth callback. Offline clients preserve the original key. Scope key by owner + normalized route/action, hash canonical body plus version precondition. Same key/hash returns original recorded status/result; different hash returns 409. Store success and job acceptance atomically with effects. Failed preconditions do not reserve a successful outcome. Parallel same-key requests serialize by unique constraint. Retain 30 days; stale offline commands beyond this age require fresh owner review/key, not automatic replay. Sync operation keys/mappings persist independently beyond that TTL.

## Routes

All paths below are relative to `/api/v1`.

| Method and route | Request → response / behavior |
| --- | --- |
| GET `/health` | Minimal `{status:"ok"}`; no DB/provider/account details. |
| POST `/auth/session` | Access-verified owner → Secure HttpOnly cookie + session DTO and CSRF token, no provider credentials. |
| GET `/auth/session` | Owner/display name, expiry and session-bound CSRF bootstrap token; never cached. Token rotation semantics must tolerate multiple tabs as described below. |
| DELETE `/auth/session` | Revoke app session, expire cookie, 204; frontend purges private offline state. Access logout is a separate supported redirect. |
| GET/PATCH `/profile` | Profile, effective zone/threshold provenance; If-Match on patch. |
| GET/PUT `/profile/zones` | Sport + metric + effective-date zone set, atomically validated. Return new profile version. |
| GET/PUT `/availability` | Effective weekly availability schedule; If-Match and response version use the profile aggregate. |
| GET/PATCH `/preferences` | `planMode`, locale, offline opt-in, import preference and validated display choices. |
| GET/POST `/goals` | List / create goal, nullable eventDate. |
| GET/PATCH/DELETE `/goals/:id` | Read/update/archive; linked blocks preserved. |
| GET/POST `/blocks` | Date-range list / create training block. |
| GET/PATCH/DELETE `/blocks/:id` | Read/update/archive via archivedAt; preserve linked workouts and historical block references. |
| GET `/calendar?from=&to=` | Workouts + compact confirmed activity links + unplanned activities + coverage. No heavyweight interval time series. |
| POST `/workouts` | `WorkoutInput`, optional `sendToGarmin:false` → workout with revision=1/version=1, optional operation ID. |
| GET `/workouts/:id` | Current plan, selected historical/sent revision, delivery status, links, notes and capabilities. |
| PUT `/workouts/:id` | Full validated definition and If-Match → new immutable revision/current version. `sendToGarmin` explicit. |
| DELETE `/workouts/:id` | `{removeFromGarmin:false|true}` + version → soft-delete plan, optional durable delete operation. |
| POST `/workouts/:id/duplicate` | `{calendarDate,localStartTime?}` → new UUID with copied definition, no sync/link. |
| POST `/workouts/:id/move` | `{calendarDate,localStartTime?,offsetChoice?,sendToGarmin:false}` + version → revision. |
| PATCH `/workouts/:id/lock` | `{locked:boolean}` + version → updated metadata, audit. |
| PATCH `/workouts/:id/notes` | `{notes:string|null}` + version; does not rewrite completed observations. |
| GET `/workouts/:id/revisions` | Paginated immutable revision summaries/details. |
| GET/POST `/templates` | Filter by sport / create from validated date-free definition. |
| GET/PUT/DELETE `/templates/:id` | Read / append template version / archive. |
| POST `/templates/:id/instantiate` | `{templateVersion,calendarDate}` → new local workout. |
| GET/POST `/recurrences` | List / finite weekly series with templateVersionId, start/end, weekdays, intervalWeeks. |
| PATCH/DELETE `/recurrences/:id` | Scope `future` or `series`, expected version; preview affected occurrences first. Locked or completed occurrences excluded with explicit result. Delete creates skip exceptions, no silent recreation. |
| POST `/recurrences/:id/materialize` | Bounded ≤93-day date range; unique series/date prevents duplicates; return created/skipped counts. |
| GET `/integrations` | Status, granted capability flags, freshness, reauth need; never raw tokens. |
| POST `/integrations/athledata/connect` | `{intent:"read"|"write"}` → verified `authorizationUrl` or actionable discovery/registration blocker. |
| GET `/integrations/athledata/callback` | AS code/state/error; server-only handler redirects to clean settings outcome URL. |
| DELETE `/integrations/athledata` | Stop calls/cancel pending jobs, revoke if supported, 202/connection status with remote revocation uncertainty. |
| POST `/integrations/athledata/sync` | `{fromDate?,toDate?,streams:["activities","recovery"]}` bounded backfill → 202 operation ID; coalesce active equivalent imports. |
| POST `/workouts/:id/garmin` | `{action:"send"|"delete",revision}` + version → 202; backend chooses create/update/reschedule using known mappings. Never accept arbitrary provider tool name or ID from browser. |
| GET `/sync/operations?state=&cursor=` | Durable operation status and safe error/retry actions. |
| GET `/sync/operations/:id` | Attempts, delivery level, sent revision, ambiguity and next retry; no raw provider content. |
| POST `/sync/operations/:id/retry` | Only safe eligible states; same operation/key, no blind create. |
| POST `/sync/operations/:id/reconcile` | Read-back request or explicit owner decision with evidence; verifies ownership before mapping external IDs. |
| GET `/activities?from=&to=&sport=` | Canonical summaries, suspected duplicates separately marked. |
| GET `/activities/:id` | Observations, provenance, quality, laps, links, revision-specific comparison and safe source references. |
| PATCH `/activities/:id/feedback` | `{rpe,notes}` + version; recompute eligible load. |
| GET `/activities/:id/matches` | Ranked candidates, evidence, score, missing features and ambiguity. |
| POST `/activities/:id/link` | `{workoutId,plannedRevision,workoutVersion,completionState,reason?}` + activity If-Match → atomic confirmed link. |
| DELETE `/activities/:id/link` | Activity If-Match → deactivate link, retain audit. |
| POST `/activities/:id/dedup` | `{candidateId,action:"merge"|"distinct",otherVersion}` + version → reviewed resolution and recomputation. |
| GET `/recovery?from=&to=` | Metric series with method/unit/coverage/freshness; no invented daily score. |
| GET/PUT `/wellness/:date` | Subjective fatigue/soreness/sleep entry, versioned. |
| GET `/dashboard?date=` | Today's plan, week summaries, eligible recovery/load cards, source/status/coverage. |
| GET `/analytics?from=&to=&sport=&scale=` | Versioned daily aggregates, explicitly chosen scale; `metricAvailability` explains missing curves. |
| GET/POST `/adaptations` | List proposals / generate deterministic proposals (adaptive mode only), no plan mutation. |
| POST `/adaptations/:id/approve` | Proposal version/input hash + target expected versions; atomic guard and revisions; no automatic Garmin write. |
| POST `/adaptations/:id/reject` | Versioned reason optional, preserves audit. |
| POST `/privacy/exports` | Fresh owner authentication → 202 job with paginated JSON/CSV scope. |
| GET `/privacy/jobs/:id` | Status and authenticated chunk endpoints, expiry, never public URLs. |
| GET `/privacy/exports/:id/chunks/:cursor` | Owner-authorized `no-store` download; bounded chunk streamed from consistent export snapshot/watermark. |
| POST `/privacy/deletions` | Fresh auth + explicit scope/confirmation; remote Garmin deletion is separate choice → durable job. |

Block DELETE is an archive operation, not a hard cascade. Recurrence edit scope and affected exclusions must be shown in preview response before the owner confirms the mutation. Add `POST /recurrences/:id/preview` for that read-only body query (auth/CSRF, no idempotency requirement).

Session CSRF bootstrap is same-origin only and never permits cross-origin reads. If a new token is issued after reload, atomically rotate its hash and notify other tabs. A stale-CSRF request must be rejected before any effect; the client can obtain a fresh token and retry once with the same idempotency key. Session expiry is not bypassed. This avoids storing a readable CSRF secret in persistent browser storage; concurrency tests must cover overlapping tab bootstraps.

## Structured workout request

Canonical AST v1, translated only by a verified provider adapter:

```json
{
  "calendarDate": "2026-11-02",
  "localStartTime": null,
  "timezone": "Europe/Oslo",
  "sport": "running",
  "title": "Terskelintervaller",
  "description": "Kontrollert innsats.",
  "intensity": "hard",
  "plannedDistanceM": null,
  "estimatedLoad": null,
  "loadScale": null,
  "definitionVersion": 1,
  "steps": [
    {"kind":"warmup","duration":{"kind":"time_s","value":900},"targets":[]},
    {"kind":"repeat","count":5,"children":[
      {"kind":"work","duration":{"kind":"distance_m","value":1000},"targets":[{"metric":"rpe","min":7,"max":7,"unit":"0-10"}]},
      {"kind":"recovery","duration":{"kind":"time_s","value":90},"targets":[]}
    ]},
    {"kind":"cooldown","duration":{"kind":"time_s","value":600},"targets":[]}
  ],
  "sendToGarmin": false
}
```

This is an illustrative plan, not athlete data. It explicitly includes recovery after the fifth repetition; removing that recovery changes the AST. Distance intervals without pace/estimate leave total duration unknown with known timed subtotal 1,950 s. Server calculates totals/quality and returns warnings; client totals are advisory. `ftp_pct` stores the athlete FTP reference used at save time; `hr_zone` snapshots zone bounds. Translation may reject RPE or sport combinations not supported by the watch. No silent target loss.

## Metric and sync DTO examples

```json
{
  "value": null,
  "unit": "ms",
  "kind": "observed",
  "source": "athledata",
  "method": "nightly_rmssd",
  "availability": "missing",
  "missingReason": "not_imported",
  "observedAt": null,
  "fetchedAt": null,
  "stale": false,
  "coverage": null
}
```

Availability enum: available/partial/missing/not_supported. `stale` is independent; derived metrics add `algorithmVersion` and input watermark. A successful stored workout response may include `delivery:{state:"queued",operationId:"uuid",sentRevision:null,deviceVerified:false}`. Never return `synced:true` immediately after queuing.

## Offline replay and cross-tab conflicts

Offline edits are drafts with base version and idempotency key, not server-accepted changes. Replay sequentially per workout only after fresh online session/CSRF acquisition. New offline workouts use client-generated UUIDs accepted after ownership/uniqueness checks; dependent edits wait for creation. Conflict 409 pauses that workout, fetches current version and shows local/remote diff; no last-write-wins on dates, structure or deletions. Owner may discard local draft or explicitly reapply onto current data with a new key/version. Background Sync API is optional; foreground reconnect is the supported iPhone path. Offline drafts never enqueue remote Garmin commands without online review.
