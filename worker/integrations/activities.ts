import { z } from "zod";
import { sportSchema, duration } from "../../shared/domain";
import { IntegrationError, digest, type IntegrationEnv } from "./base";
import { at, type Contract } from "./mcp";
const activitySchema = z.object({
  externalId: z
    .union([z.string().min(1), z.number().int().nonnegative().safe()])
    .transform(String),
  upstreamId: z
    .union([z.string().min(1), z.number().int().nonnegative().safe()])
    .transform(String)
    .optional(),
  sport: sportSchema,
  startAt: z.string().datetime({ offset: true }),
  elapsedSeconds: z.number().nonnegative().nullable().default(null),
  distanceM: z.number().nonnegative().nullable().default(null),
  avgHr: z.number().positive().nullable().default(null),
  avgPower: z.number().nonnegative().nullable().default(null),
  plannedExternalId: z
    .union([z.string().min(1), z.number().int().nonnegative().safe()])
    .transform(String)
    .optional(),
});
export function normalizeActivity(profile: Contract, input: unknown) {
  if (!profile.fields || !profile.originNamespace)
    throw new IntegrationError("IMPORT_MAPPING_REQUIRED");
  const mapped: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(profile.fields))
    mapped[field] = at(input, path);
  return activitySchema.parse(mapped);
}
export async function importPage(
  e: IntegrationEnv,
  account: string,
  profile: Contract,
  result: unknown,
) {
  if (!profile.itemsPath) throw new IntegrationError("IMPORT_MAPPING_REQUIRED");
  const items = at(result, profile.itemsPath);
  if (!Array.isArray(items) || items.length > 100)
    throw new IntegrationError("IMPORT_PAGE_LIMIT");
  const normalized = items.map((item) => normalizeActivity(profile, item));
  for (const a of normalized) {
    const canonicalId = a.upstreamId || a.externalId,
      namespace = a.upstreamId ? "garmin" : profile.originNamespace!;
    const id = await digest(account + ":" + namespace + ":" + canonicalId),
      now = Date.now();
    const localDate = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(a.startAt));
    const snapshot = JSON.stringify(a),
      hash = await digest(snapshot);
    await e.DB.batch([
      e.DB.prepare(
        "INSERT INTO completed_activities(id,user_id,account_key,external_activity_id,origin_namespace,sport,start_at,local_date,elapsed_s,distance_m,avg_hr_bpm,avg_power_w,planned_external_id,details_json,payload_hash,fetched_at) VALUES(?,'owner',?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_key,origin_namespace,external_activity_id) DO UPDATE SET elapsed_s=COALESCE(excluded.elapsed_s,elapsed_s),distance_m=COALESCE(excluded.distance_m,distance_m),avg_hr_bpm=COALESCE(excluded.avg_hr_bpm,avg_hr_bpm),avg_power_w=COALESCE(excluded.avg_power_w,avg_power_w),details_json=excluded.details_json,payload_hash=excluded.payload_hash,version=version+1,fetched_at=excluded.fetched_at WHERE payload_hash<>excluded.payload_hash",
      ).bind(
        id,
        account,
        canonicalId,
        namespace,
        a.sport,
        Date.parse(a.startAt),
        localDate,
        a.elapsedSeconds,
        a.distanceM,
        a.avgHr,
        a.avgPower,
        a.plannedExternalId ?? null,
        snapshot,
        hash,
        now,
      ),
      e.DB.prepare(
        "INSERT OR IGNORE INTO activity_sources VALUES(?,?,?,?,?)",
      ).bind(
        await digest(account + ":" + a.externalId),
        id,
        "athledata",
        a.externalId,
        account,
      ),
      e.DB.prepare(
        "INSERT OR IGNORE INTO activity_revisions VALUES(?,?,?,?)",
      ).bind(id + ":" + hash, id, snapshot, now),
    ]);
    if (a.plannedExternalId) {
      const matches = await e.DB.prepare(
        "SELECT r.workout_id,r.planned_revision FROM external_workout_refs r JOIN workouts w ON w.id=r.workout_id JOIN workout_revisions v ON v.workout_id=r.workout_id AND v.revision=r.planned_revision WHERE r.account_key=? AND r.external_workout_id=? AND v.sport=? AND json_extract(v.snapshot_json,'$.calendarDate')=? AND w.deleted_at IS NULL GROUP BY r.workout_id,r.planned_revision",
      )
        .bind(account, a.plannedExternalId, a.sport, localDate)
        .all<any>();
      if (matches.results.length === 1) {
        const m = matches.results[0];
        await e.DB.prepare(
          "INSERT OR IGNORE INTO workout_activity_links VALUES(?,?,?,?, 'direct_id',1,?,NULL)",
        )
          .bind(crypto.randomUUID(), m.workout_id, id, m.planned_revision, now)
          .run();
      }
    }
  }
  const cursor = profile.cursorPath ? at(result, profile.cursorPath) : null;
  if (cursor !== null && cursor !== undefined && typeof cursor !== "string")
    throw new IntegrationError("INVALID_IMPORT_CURSOR");
  await e.DB.prepare(
    "INSERT INTO import_cursors VALUES('athledata',?,?) ON CONFLICT(integration_id) DO UPDATE SET cursor_json=excluded.cursor_json,last_success_at=excluded.last_success_at",
  )
    .bind(JSON.stringify(cursor ?? null), Date.now())
    .run();
  return { imported: normalized.length, nextCursor: cursor ?? null };
}
export async function candidates(e: IntegrationEnv, id: string) {
  const activity = await e.DB.prepare(
    "SELECT * FROM completed_activities WHERE id=? AND user_id='owner'",
  )
    .bind(id)
    .first<any>();
  if (!activity) throw new IntegrationError("ACTIVITY_NOT_FOUND", 404);
  const rows = await e.DB.prepare(
    "SELECT w.id,w.version,w.current_revision,r.snapshot_json FROM workouts w JOIN workout_revisions r ON r.workout_id=w.id AND r.revision=w.current_revision WHERE w.calendar_date=? AND w.deleted_at IS NULL AND r.sport=? AND NOT EXISTS(SELECT 1 FROM workout_activity_links l WHERE l.workout_id=w.id AND l.unlinked_at IS NULL)",
  )
    .bind(activity.local_date, activity.sport)
    .all<any>();
  return rows.results
    .map((w) => {
      const plan = JSON.parse(w.snapshot_json),
        d = duration(plan.steps).seconds;
      const similarity =
        d && activity.elapsed_s
          ? Math.max(
              0,
              1 -
                Math.abs(d - activity.elapsed_s) /
                  Math.max(d, activity.elapsed_s),
            )
          : 0;
      return {
        workoutId: w.id,
        version: w.version,
        revision: w.current_revision,
        title: plan.title,
        score: 0.35 + 0.2 * similarity,
        requiresApproval: true,
        missingEvidence: ["planned_start_time", "interval_structure"],
      };
    })
    .sort((a, b) => b.score - a.score);
}
export async function comparison(e: IntegrationEnv, id: string) {
  const activity = await e.DB.prepare(
    "SELECT * FROM completed_activities WHERE id=? AND user_id='owner'",
  )
    .bind(id)
    .first<any>();
  if (!activity) throw new IntegrationError("ACTIVITY_NOT_FOUND", 404);
  const link = await e.DB.prepare(
    "SELECT l.*,r.snapshot_json FROM workout_activity_links l JOIN workout_revisions r ON r.workout_id=l.workout_id AND r.revision=l.planned_revision WHERE l.activity_id=? AND l.unlinked_at IS NULL",
  )
    .bind(id)
    .first<any>();
  const planned = link ? JSON.parse(link.snapshot_json) : null;
  const plannedSeconds = planned ? duration(planned.steps).seconds : null;
  return {
    activity,
    planned,
    plannedRevision: link?.planned_revision ?? null,
    comparison: {
      plannedSeconds,
      actualSeconds: activity.elapsed_s,
      deltaSeconds:
        plannedSeconds !== null && activity.elapsed_s !== null
          ? activity.elapsed_s - plannedSeconds
          : null,
    },
    kind: "observed",
  };
}
