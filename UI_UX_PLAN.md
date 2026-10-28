# Interface and PWA specification

All product text is Norwegian Bokmål (`nb-NO`); developer documentation may remain English. Dates, decimal commas, 24-hour time and Monday-first weeks use Europe/Oslo. Design for a 390 px iPhone first, then 768 px tablet and ≥1024 px desktop. No athlete statistics, trend lines, recovery scores or event dates are invented to fill empty screens.

## Visual system

| Token | Initial value / rule |
| --- | --- |
| Background | `#111315` charcoal |
| Navigation | `#080A0B` near black |
| Surface / elevated | `#1C2023` / `#252B2F` graphite |
| Border | `#343C41` |
| Text / secondary | `#F4F6F2` / `#B4BCB6` |
| Accent | `#CBF66A`, dark `#152008` text on accent |
| Error / warning | `#FF8585` / `#F4CE73`, always with text/icon |
| Typography | System UI stack, tabular numbers for metrics; no required remote font requests |
| Spacing / radius | 4 px base, 16–24 px card padding; 12 px controls, 20 px cards |
| Motion | 120–180 ms opacity/transform; respect reduced motion, no continuous animated charts |

WCAG AA contrast must be measured with final component combinations, not assumed from tokens. Sport accent tokens: running lime, cycling blue, xc skiing cyan, SkiErg purple, swimming teal, strength orange, recovery pale green, mobility pink. Every sport has a text label and distinct icon; color alone never encodes meaning. Observed data uses solid chart marks, planned data uses dashed outlines and explicit legend labels; calculated metrics have an information label.

## Screen hierarchy

```text
AppShell
  SessionGate / OfflineLock
  DesktopSidebar OR MobileBottomNavigation
  ConnectionBanner + OfflineDraftBanner (only when relevant)
  RouteOutlet
    Hjem
      TodayWorkoutList → WorkoutDetail
      WeeklySummary → Analyse
      RecoverySummary / FitnessSummary (eligible data only)
      PendingSuggestions / PendingMatches
    Kalender
      CalendarToolbar + DateNavigator + SportFilter
      DayAgenda / WeekGrid / MonthGrid
      WorkoutCard → WorkoutDetail → WorkoutEditor
      AddWorkoutSheet / TemplatePicker / RecurrenceEditor
      BlockOverview / PendingSyncPanel
    Analyse
      RangePicker + SportSelector + LoadScaleSelector
      Volume / Load / Recovery / Goals / Execution
      ChartCard + AccessibleDataTable + CoverageNote
    Økter
      PlannedList / CompletedList / Templates
      ActivityDetail → PlannedActualComparison / LapTable
      WorkoutBuilder / TemplateEditor / MatchReview
    Innstillinger
      Profile / Zones / Goals / Availability / TrainingMode
      AthleDataConnection / SyncHistory
      OfflineStorage / ExportAndDelete / Session
```

Desktop sidebar: brand, five navigation items, compact connection state at bottom. Mobile bottom navigation: `Hjem`, `Kalender`, `Analyse`, `Økter`, `Innstillinger`, icons plus persistent labels, safe-area padding. Page titles and a single primary action stay easy to reach. Never hide critical sync failures only in a toast.

## Main screens and interactions

### Hjem

Date-aware greeting without assuming name. “I dag” displays all planned sessions with sport, duration quality, targets and sent revision. A completed linked session shows “Planlagt” and “Gjennomført” separately and opens comparison. “Denne uken” shows planned hours, completed hours, running distance, cycling/SkiErg time and consistency with coverage. “Synkroniser” displays last successful import and current progress; it does not imply watch delivery.

Recovery/fitness cards appear only with valid data. Otherwise show a compact explanation (“Ingen HRV-data ennå”) and connection/import action, not a fabricated chart. A missing CTL curve explains history/scale requirements. Loading skeletons have no placeholder numbers. A first-run dashboard directs to “Planlegg en økt”, “Opprett mål”, and optional “Koble til AthleData”.

### Kalender

The default mobile view is a week date strip with agenda; day/week/month toggle preserves selected date. Desktop week uses seven columns; month cells show two/three compact cards with accessible overflow count. Day view shows untimed sessions first then times, not artificial hourly placement. Multiple sessions per day are first-class.

Creation: tap date or “Ny økt”, select sport/template, enter structure, save locally or “Lagre og send til Garmin” when capability is verified. Editing displays lock, version and delivery state. Locked sessions require explicit unlock. Delete dialog separates local plan removal and Garmin removal. Duplicate asks date and starts unsynced. Move supports date picker and keyboard action; desktop drag/drop is optional enhancement with undo as a new versioned mutation. Mobile long-press is never the only route to an action.

Recurring edits ask “Denne økten” or “Denne og fremtidige” using an impact preview. A complete series action is explicit; completed/locked occurrences are excluded and counted. The first version supports finite weekly recurrence, not arbitrary RRULE. Training blocks appear as restrained date bands and a goal-linked overview, never replacing individual workouts.

### Structured workout builder

Sport/title/date at top. Step list cards: “Oppvarming”, “Arbeid”, “Pause”, “Nedtrapping”, “Fri økt”, “Gjenta”. Add/reorder/remove via accessible buttons; drag is optional. Repeat container clearly shows child steps and repeat count, including final recovery behavior. Each leaf chooses time/distance/open duration and compatible target type with units. HR zones/FTP references are shown as snapshots when relevant.

Sticky summary: exact or estimated total time, distance if known, and warnings. An unknown total displays “Varighet ikke beregnet” plus known subtotal, not zero. Show provider incompatibility inline before send; preserve the richer local workout and offer an explicit user-reviewed adaptation if possible. Saving as template excludes date, completion and external IDs. Form unsaved changes warn on route changes and survive offline as a draft.

### Økter and completed analysis

Tabs for planned, completed and templates. Completed detail presents planned/sent revision, observed summary, laps and comparison. Duration types (elapsed/moving), pace, watts, HR and load scale are labeled. Lap alignment confidence appears where heuristic. Unavailable measures stay blank with reason. RPE and athlete notes are editable independently of provider observations. Matching review shows candidate date, sport, time/duration differences and score evidence; manual link/unlink is always available. Suspected duplicate imports have a separate review banner and do not inflate totals.

### Analyse and adaptation

Ranges 7/28/90/365 days and custom ≤366; sport and compatible load-scale selector. Charts lazy load, maintain gaps for unknown data and show coverage/staleness. Mobile chart tap selects a point without requiring hover; provide a scrollable table and concise trend explanation. No combined axis for incompatible load scales. Goal charts only use confirmed goal parameters and actual records.

Fixed mode visibly states “Planen endres bare av deg”. Adaptive mode shows proposal cards with proposed before/after, supporting measurements/times, missing inputs and rule explanation. “Godkjenn”/“Avvis” are explicit; approval may fail as stale and prompt refresh. Approval changes local plan only; an additional “Send endringer til Garmin” action is required. Never touch locked workouts.

## Client state and component contracts

TanStack Query owns server state, keyed by resource/date range/sport/scale; invalidate affected calendar, workout, operation, activity and analytics keys after mutations. Poll only active operation views while visible, with backoff; stop on terminal state or page hide. No background 1-second global polling. Use query cancellation and stable placeholder layout across range changes.

React Hook Form + shared Zod schemas own editable forms. Component state owns sheets, selected date and chart focus. URL parameters preserve date/view/range. Offline drafts/outbox are a distinct IndexedDB store; do not persist the entire query cache. Only low-risk local labels may update optimistically; versioned structure, remote delivery, deletes and approvals wait for server result or show clearly pending state. Multi-tab BroadcastChannel/storage events notify session logout and accepted revisions, with a compatible fallback.

Shared components: `MetricValue` requires unit/kind/availability; `FreshnessLabel`, `CoverageNote`, `SyncBadge`, `SportBadge`, `EmptyState`, `ErrorState`, `VersionConflictDialog`, `ConfirmDialog`, `AccessibleChart`, `OfflineBanner`. Avoid every page implementing its own missing-data policy.

Loading: skeleton for initial fetch, subtle busy state for refetch, preserve last known data with “Sist oppdatert” when offline. Error: contextual Norwegian message, retry where safe, support/request ID without secrets. Session expiry preserves draft, prompts sign-in and does not automatically retry a remote write. Capability loss disables only dependent controls with reason.

## Accessibility and mobile behavior

Minimum 44×44 px touch targets; logical keyboard order, visible focus, escape/close behavior and restored focus for sheets/dialogs. shadcn primitives are a starting point, not proof of accessibility. Label icons and inputs, associate field errors, announce sync/conflict outcomes with restrained `aria-live`. Support VoiceOver and 200% text zoom. Use semantic lists/tables and headings; provide keyboard alternatives for date selection and reordering. Do not lock page zoom. Use `100dvh`, scrollable content and `env(safe-area-inset-*)`; account for the iPhone keyboard without obscuring Save.

## PWA design

Manifest: stable `id`, `name: ENDURANCE OS`, `short_name: Endurance`, `lang: nb`, `start_url: /`, `scope: /`, `display: standalone`, charcoal background/theme. Supply actual 192/512 px icons, maskable icon with safe zone and 180 px apple-touch icon. Manifest/install icons contain no private data. Safari install guidance explains Share → Add to Home Screen when appropriate; do not assume `beforeinstallprompt` exists on iOS.

Service worker strategy: precache only versioned public shell JS/CSS/fonts/icons and an offline shell document containing no embedded athlete data. Cache-first hashed assets; navigation network-first with offline shell fallback after a short timeout. Never cache `/api`, OAuth callbacks, Access login redirects, auth responses, tokens or exports. Validate response content/type; an Access login page must not poison shell cache. Public shell assets may be served without session because they contain no secrets; every data endpoint stays protected. Deployment must test the Access interaction for these routes.

Offline calendar is opt-in with explicit device privacy notice. Store only a rolling previous 28/next 56-day minimal calendar projection, versions, timestamps and drafts in IndexedDB. Recovery, tokens, full activity details and raw provider content are excluded. Sensitive notes/description are excluded from read cache by default, though a draft may contain text the athlete is editing. Cache lives until cleared/expired/evicted; show quota failure and allow manual purge. iOS may evict it; the server remains authoritative.

Offline access permits only the cached authorized device copy and never grants server authority. Set a local offline-read expiry of 7 days since the last successful authentication; show a lock screen after expiry until online. This is a usability control, not cryptographic protection against someone with device storage access. Remote session revocation cannot immediately erase a disconnected phone. Do not claim token encryption protects cached calendar data. Owner can disable offline storage entirely; use device lock protection.

Offline edits save local drafts with base version/key. Delete becomes a pending draft action. No provider commands, OAuth, exports or adaptation approvals offline. On foreground reconnect: authenticate, refresh base data, replay reviewed local drafts per entity using idempotency, stop conflicts for explicit compare/reapply. No dependency on iOS Background Sync, silent background Cron or push. “Lagret på enheten” and “Lagret i ENDURANCE OS” are distinct states.

Update flow: new service worker waits; show “Ny versjon tilgjengelig”. Persist drafts before activation/reload and remove old static caches after clients upgrade. Version IndexedDB schema separately with tested upgrades; incompatible drafts are exported/preserved for recovery, not discarded. Logout/user-disable online purges IndexedDB/private memory and broadcasts to tabs; next online contact after revocation also purges. An offline logout still clears local data immediately and queues session revocation upon reconnect without retaining its bearer secret in JS storage.

## Acceptance matrix

Test real Safari iPhone installed and browser modes, desktop Safari/Chrome/Firefox and tablet layout. Automated Playwright WebKit is useful but not proof of iOS installation/device behavior. Verify safe areas, VoiceOver, text zoom, keyboard, offline cold launch, stale session, multiple tabs, storage eviction, SW upgrade with dirty drafts, loss of network during mutation, DST dates, sparse metrics and 100+ workouts in a month. No live preview links are part of this architecture task.
