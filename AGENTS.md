# Instructions for future Codex sessions

## Scope and authoritative design

ENDURANCE OS is a private Norwegian personal training application for one athlete. Read ARCHITECTURE.md and DEVELOPMENT.md before work; read the schema, API, integration, sync, UI, security and roadmap documents for the components you change. The latest user request determines scope. This task was architecture-only: do not treat these specifications as implemented code or start implementation without a subsequent implementation request.

Use the existing checkout under `/workspace/Endurance-os`. Cloud tasks are already isolated; do not create another worktree unless explicitly requested. Inspect `git status`, existing code, scripts, lockfiles and instructions first. Preserve user changes and functional configuration. Reuse working code, adapters and UI components. Do not replace the application stack or perform unrelated refactors for convenience.

## Implementation boundaries

- One Worker with React/Vite static assets, official Cloudflare Vite plugin, D1 and Cron. Native prepared SQL with versioned migrations. No extra service/queue/AI subscription without a concrete measured need and documented architectural decision.
- Norwegian Bokmål UI, Oslo calendar dates, UTC audit instants and explicit units. Never invent observations, event dates, physiological baselines or successful sync state. Synthetic test data must be labeled and never injected into live athlete views.
- Keep immutable planned revisions and actual observations separate. API versions protect edits; local drafts are not accepted writes. Templates and duplicates never copy external IDs/completion links.
- Dynamic MCP discovery does not authorize arbitrary tool execution. Use the official compatible SDK, verified provider schemas and explicit capability adapters. Standalone OAuth is independent of any tool connector. Never fabricate endpoints/scopes or assume candidate tool names work.
- Preserve ID lineage on Garmin replacement; never blindly retry an ambiguous remote write or silently convert update into create. Persistent idempotency and reconciliation are required. Local exactly-once effects do not imply remote exactly-once delivery.
- Never overwrite locked workouts. Adaptive proposals require explicit, version-checked owner approval; fixed mode never auto-adjusts. Approval of a proposal is not permission to send it to Garmin.
- Auth/session/CSRF and owner authorization apply to all private API paths. Keep tokens server-side, encrypted at rest, and out of logs/browser bundles. Do not expose arbitrary issuer/tool fetches. No production auth bypass/default credentials.

## Work sequence and tests

Follow IMPLEMENTATION_PLAN.md dependencies. Install only dependencies needed for the authorized phase. Verify current compatible stable versions, lock them through the package lock and use frozen/reproducible installs. Preserve TLS/signature/checksum verification. Never log environment values or credential files; inspect only names/presence when diagnosing missing configuration.

Before migrations, verify exact database binding and local/staging/production target. Use local D1 first; test foreign keys, unique keys and transactional rollback. Do not assume a zero-row CAS aborts a D1 batch or that a database transaction spans an awaited provider call. Never reset a populated database to fix a migration without explicit authorization and recoverability.

The repository now provides `dev`, `db:migrate:local`, `typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `test:pwa`, `build`, `build:production`, `production:check` and `verify`. Use these actual scripts and keep documentation accurate. `verify` runs deterministic local checks; live OAuth/Garmin tests are separate, explicitly authorized and never automatic CI writes. No deploy or remote migration hidden inside install/test scripts. `PRODUCTION_SETUP.md` documents current release gates; architectural documents also describe future functionality, not only implemented code.

Run tests proportionate to changed behavior: pure domain unit tests, real workerd/D1 boundary tests, UI browser tests, and physical/provider validation where required. Test retry ambiguity, race/rollback, timezone/DST, missing data and offline conflicts. Do not weaken assertions, replace meaningful checks with zero-test runs or claim fixtures prove a real provider/device roundtrip. Inspect failures, fix in-scope causes and rerun affected tests.

Use `apply_patch` for file changes; never overwrite unrelated user files. Document meaningful design changes and keep schema, API, states and UI consistent. Update DEVELOPMENT.md with actual progress, executed commands/outcomes, unresolved blockers and next task. Preserve the distinction between current-instance validation, saved reusable setup, publication/deployment and a fresh-task restore.

## External state and completion

Do useful independent work before requesting missing credentials or decisions. Values belong in secure platform settings, not chat or source. No deploy, provider writes, deletion of remote workouts, public sharing or destructive migration is implied by reading architecture docs. Follow the current user's explicit authorization and report unsupported capabilities precisely. A physically confirmed watch arrival is different from tool acceptance.

At handoff, describe what changed, what passed, what remains untested and the next concrete task. Never label the app production-ready while required authentication, durability or real integration gates remain unverified.
