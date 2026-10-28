# Development status

## Implementation update — 2026-10-28

The subsequent user request authorized foundation and training-calendar implementation. The earlier architecture-only status below is retained as history.

Implemented React/TypeScript/Vite with the official Cloudflare plugin, Tailwind, shadcn-style local button and Radix dialog primitives, Lucide, TanStack Query, React Hook Form, Zod and lazy Recharts. Norwegian mobile bottom navigation/desktop sidebar, dashboard, day/week/month calendar, desktop drag/drop and touch date-picker move, versioned workout CRUD, duplicates, locking, explicit manual completion, nested structured steps/targets/reordering, persistent template CRUD/instantiation, profile/goals, real-data analytics and integration empty states are available.

Worker API uses `/api/v1`, D1 prepared statements and transactional guards, append-only plan snapshots, separate manually reported actual duration, CSRF, opaque hashed sessions, secure HttpOnly cookies, expiration, login rate limiting, idempotency keys and input limits. Production identity verifies Cloudflare Access issuer/audience/signature/owner subject. Local owner identity is restricted to Vite development mode and matching loopback origin; production compilation makes that predicate always false. No password, provider token or athlete measurement is fabricated.

Migrations `0001_foundation.sql` and `0002_queryable_fields.sql` implement the current slice. Profiles/goals and structured definitions are validated JSON aggregates with typed generated SQL projections; revisions/steps/templates/completions are separate relational entities. This is an incremental implementation of DATABASE_SCHEMA.md, not the full future 46-table schema. Before provider integration, finish the dedicated normalized target/provenance fields, connection/outbox/import migrations and additional database-level invariant enforcement. Manual completions are a new `manual_completions` table required by this phase, bound to the specific planned revision; they are not fake imported Garmin activities. Full recurrence, block editing, adaptive suggestions and provider operations remain outside this implementation request.

PWA foundation includes manifest, SVG and real 180/192/512px icons, static-only service worker, safe areas, network indicator and opt-in 7-day read-only IndexedDB calendar cache. No API responses or tokens enter service-worker caches. No offline writes are claimed. Chart JS is deferred; last measured initial JS was about 147 KB gzip, chart bundle about 101 KB gzip.

Verified locally: typecheck, ESLint, 11 Vitest tests (4 domain and 7 authenticated API/D1 tests), production build, both D1 migrations and repeat application. Tests use actual local workerd-backed D1. Chromium browser checks passed login, workout create, reload persistence, manual completion, 390px mobile overflow check, deletion, opt-in offline calendar read and disabled offline creation, with no page errors. Desktop/mobile screenshots were inspected in `/tmp`. Browser smoke fixtures are soft-deleted afterward; no active synthetic workouts are left in the calendar.

Remaining release gates: configure actual Cloudflare Access owner/team/audience, HTTPS origin and production D1 IDs; verify a real owner login/Access policy and session behavior in deployed staging. Physical iPhone/Safari installation, VoiceOver and cold-launch service-worker behavior have not been verified. No cloud resource/deployment or live AthleData/Garmin request was made. Accordingly this is a locally tested implementation, not a claim that all production acceptance gates or the complete architecture are finished.

Run locally: `npm ci`, `npm run db:migrate:local`, `npm run dev`. Run checks: `npm run verify`; while the local server runs, `npm run test:e2e` (Chromium executable defaults to `/usr/bin/chromium`, override `CHROMIUM_PATH`). Workspace-local npm/Cloudflare caches avoid unwritable home directories. See README.md for owner setup. Next: resolve production identity/PWA gates, then Phase 3 standalone AthleData OAuth/MCP verification; no live write integration yet.

Final continuation checks: clean `npm ci` succeeded, reapplying local migrations reported no pending changes, `npm run verify` and `npm run test:e2e` passed again. A direct request against the compiled production Worker rejected local identity with 503 as intended; a running development Worker successfully authenticated and read its persisted D1 profile. Cloud environment draft fields `install_script` and `start_skill` were saved successfully with tested commands and readiness checks. This does not publish the environment, deploy the application or verify restoration in a new task. The environment still references the original remote repository configuration; new local code must be preserved before relying on a fresh remote checkout.

Updated 2026-10-28, Europe/Oslo.

## Completed in this task

Architecture documentation only. All ten requested documents exist: ARCHITECTURE.md, DATABASE_SCHEMA.md, ATHLEDATA_INTEGRATION.md, GARMIN_SYNC_DESIGN.md, API_DESIGN.md, UI_UX_PLAN.md, IMPLEMENTATION_PLAN.md, SECURITY.md, DEVELOPMENT.md and AGENTS.md.

The repository started empty with Git metadata and an unborn `work` branch. No existing application or configuration was overwritten. No frontend/backend code, migrations, package manifest, dependency installation, cloud resources, setup/start scripts or deployment were created. There is no running or production-ready application to report.

Documents define one Worker + D1, official Vite integration, owner authentication, structured versioned plans, explicit Garmin delivery, durable ambiguity/reconciliation, incremental observed activity import, conservative matching, metrics with provenance/coverage, deterministic approved suggestions and a Norwegian iPhone PWA.

## Verified observations

| Check | Result |
| --- | --- |
| Repository inspection | No source/manifests/agent instructions existed; no local commits. |
| Available toolchain | Node v24.19.0, npm 11.9.0. These were inspected, not installed or validated against an app. |
| Supplied AthleData endpoint GET | Outbound proxy CONNECT 403 before reaching provider, including escalated retry. Provider capabilities remain unknown. |
| Credential presence check | No exported names matching AthleData/Garmin/Cloudflare/OAuth found. No credential values printed. This is not proof about external account bindings. |
| Official MCP SDK source/npm | Source describes stable split v2 client; registry reports @modelcontextprotocol/client 2.4.0, workerd shim/validator exports. Runtime compatibility untested. |
| Official MCP authorization source | 2025-11-25 source retrieved; newer version mentioned in README was not retrieved at the attempted source path. Follow negotiated/current protocol during implementation. |
| Official Cloudflare source docs | Vite/workerd support, D1 batch transactions, consistency API, limits and pricing model retrieved. Actual account eligibility/costs unverified. |

Sources and detailed gate matrix are in ATHLEDATA_INTEGRATION.md. The earlier remote `main` lookup failed during onboarding; this task uses the existing empty checkout and does not need a remote branch to create the requested documents. No push or branch publication was attempted.

## External prerequisites and integration blockers

1. Allow outbound access to `mcp.athletedata.health` for research/testing; then discover/validate actual authorization hosts and grant only necessary additional access. No network policy changed in this task.
2. Determine whether an independent OAuth client can register, which exact callbacks/scopes/S256/resource semantics are supported, and whether refresh/revocation work. A Codex connection is not a substitute.
3. Verify actual MCP tools/schemas, write permissions, create/update/schedule/delete semantics, replacement ID lifecycle, upstream idempotency/read-back and provider account identity.
4. Verify Fenix 6 supported structures and delivery on the actual watch; the owner must confirm physical device steps during the later roundtrip test.
5. Verify imported activities/recovery identifiers, units, pagination, lateness, coverage, retention and planned-ID relationships.
6. Before live staging/production auth: configure Cloudflare Access team/audience/owner identity, secure Worker secrets, exact origin and D1 binding. Confirm standalone Safari and fresh-auth semantics. No credentials should be pasted into chat or docs.

These block dependent live implementation/claims, not completion of this architecture or local Phase 1/2 work. No request to approve deployment is needed now because deployment was explicitly excluded.

## Validation scope

Documentation review checks file completeness, local links, consistent table/route/state names, architecture-only repository changes and coverage of the specified lifecycle. No application, OAuth, D1 migration, UI, Garmin or physical-device tests have run; there is no implementation to run them against. A documentation check is not an integration test.

Executed documentation checks: a Node read-only validator confirmed all 10 requested files, 15 relative links, balanced code fences, 3 valid JSON examples, 46 named table definitions plus the described mutation-guard helper, all 8 roadmap phases and no unexpected project files. It returned zero errors. Manual consistency review aligned proposal versions, block archive semantics, profile/activity aggregate versions, external-ID generations, provider fitness observations and session/purge foreign-key behavior. Git status shows only the ten new Markdown documents; none were committed or pushed.

## Next work

First implementation task: Phase 1 foundation and isolated local authentication/persistence tests. Follow the exact prompt in IMPLEMENTATION_PLAN.md. In parallel with local work, resolve read-only provider discovery/registration questions early. After standalone OAuth and the minimal calendar exist, prioritize the small real Garmin roundtrip before broad sync, analytics and adaptive features.

Future sessions must update this file with files changed, exact executed tests and outcomes, necessary migration/secret changes, remaining blockers and next task. Keep unrun external checks explicit; never mark a phase passed because only fixtures or compilation passed.
