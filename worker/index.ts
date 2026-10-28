import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import {
  inputSchema,
  definitionSchema,
  profileSchema,
  goalSchema,
  dateSchema,
  duration,
  type Step,
} from "../shared/domain";
export interface Env {
  DB: D1Database;
  AUTH_MODE: string;
  APP_ORIGIN: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_ACCESS_SUB?: string;
}
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(
    { data },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      },
    },
  );
const local = (r: Request, e: Env) =>
  import.meta.env.DEV &&
  e.AUTH_MODE === "local" &&
  ["127.0.0.1", "localhost"].includes(new URL(r.url).hostname) &&
  new URL(r.url).origin === e.APP_ORIGIN;
async function identity(r: Request, e: Env) {
  if (local(r, e)) return "local-owner";
  if (
    e.AUTH_MODE !== "access" ||
    !e.ACCESS_TEAM_DOMAIN ||
    !e.ACCESS_AUD ||
    !e.OWNER_ACCESS_SUB
  )
    fail(503, "AUTH_CONFIG", "Sikker innlogging må konfigureres.");
  try {
    const issuer = `https://${e.ACCESS_TEAM_DOMAIN}`;
    const jwt = r.headers.get("Cf-Access-Jwt-Assertion") || "";
    const { payload } = await jwtVerify(
      jwt,
      createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs")),
      { issuer, audience: e.ACCESS_AUD, algorithms: ["RS256"] },
    );
    if (payload.sub !== e.OWNER_ACCESS_SUB) throw Error();
    return payload.sub;
  } catch {
    fail(401, "AUTH_REQUIRED", "Logg inn med eierkontoen.");
  }
}
async function body(r: Request) {
  if (!r.headers.get("content-type")?.startsWith("application/json"))
    fail(415, "CONTENT_TYPE", "Bruk JSON.");
  const reader = r.body?.getReader();
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        fail(413, "TOO_LARGE", "Forespørselen er for stor.");
      }
      text += decoder.decode(value, { stream: true });
    }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    fail(400, "JSON", "Ugyldig JSON.");
  }
}
function sameOrigin(r: Request, e: Env) {
  if (r.headers.get("Origin") !== e.APP_ORIGIN)
    fail(403, "ORIGIN_DENIED", "Ugyldig opprinnelse.");
}
async function bootstrap(e: Env, sub: string) {
  const now = Date.now();
  await e.DB.batch([
    e.DB.prepare("INSERT OR IGNORE INTO users VALUES('owner',?,?)").bind(
      sub,
      now,
    ),
    e.DB.prepare(
      "INSERT OR IGNORE INTO athlete_profiles(user_id,data) VALUES('owner',?)",
    ).bind(JSON.stringify({ maxHr: 185, ftp: 228, pb10k: 2440 })),
    e.DB.prepare(
      "INSERT OR IGNORE INTO user_preferences(user_id,data) VALUES('owner','{}')",
    ),
  ]);
  const owner = await e.DB.prepare(
    "SELECT access_subject FROM users WHERE id='owner'",
  ).first<{ access_subject: string }>();
  if (owner?.access_subject !== sub)
    fail(403, "OWNER_REQUIRED", "Feil eierkonto.");
}
async function handle(r: Request, e: Env) {
  const url = new URL(r.url),
    p = url.pathname.replace("/api/v1", ""),
    method = r.method;
  if (p === "/health" && method === "GET") return json({ status: "ok" });
  const allowed =
    method === "GET" ||
    (p === "/auth/session" && ["POST", "DELETE"].includes(method)) ||
    (["/profile", "/preferences"].includes(p) && method === "PATCH") ||
    (/^\/(goals|templates)$/.test(p) && method === "POST") ||
    (/^\/(goals|templates)\/[^/]+$/.test(p) &&
      ["PATCH", "PUT", "DELETE"].includes(method)) ||
    (p === "/workouts" && method === "POST") ||
    (/^\/workouts\/[^/]+$/.test(p) &&
      ["PUT", "PATCH", "DELETE"].includes(method)) ||
    (/^\/workouts\/[^/]+\/(move|duplicate|complete)$/.test(p) &&
      method === "POST") ||
    (/^\/workouts\/[^/]+\/lock$/.test(p) && method === "PATCH");
  if (!allowed) fail(405, "METHOD_NOT_ALLOWED", "Handlingen er ikke støttet.");
  const sub = await identity(r, e),
    now = Date.now();
  if (p === "/auth/session" && method === "POST") {
    sameOrigin(r, e);
    await body(r);
    const bucket = `login:${Math.floor(now / 600000)}`;
    const rate = await e.DB.prepare(
      "INSERT INTO rate_limit_buckets VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    )
      .bind(bucket, now + 600000)
      .first<{ count: number }>();
    if ((rate?.count || 0) > 10)
      fail(429, "RATE_LIMIT", "Prøv igjen om ti minutter.");
    await e.DB.batch([
      e.DB.prepare(
        "DELETE FROM auth_sessions WHERE expires_at<? OR idle_expires_at<?",
      ).bind(now, now),
      e.DB.prepare("DELETE FROM rate_limit_buckets WHERE expires_at<?").bind(
        now,
      ),
      e.DB.prepare("DELETE FROM api_idempotency WHERE created_at<?").bind(
        now - 2592000000,
      ),
    ]);
    await bootstrap(e, sub);
    const t = token(),
      csrf = token();
    await e.DB.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)")
      .bind(
        crypto.randomUUID(),
        "owner",
        await hash(t),
        await hash(csrf),
        now + 86400000,
        now + 28800000,
      )
      .run();
    return json({ csrf, local: local(r, e) }, 200, {
      "Set-Cookie": `__Host-eos_session=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`,
    });
  }
  const t = r.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)__Host-eos_session=([^;]+)/)?.[1];
  const s = t
    ? await e.DB.prepare(
        "SELECT * FROM auth_sessions WHERE token_hash=? AND expires_at>? AND idle_expires_at>?",
      )
        .bind(await hash(t), now, now)
        .first<{ id: string; csrf_hash: string; user_id: string }>()
    : null;
  if (!s) fail(401, "AUTH_REQUIRED", "Logg inn for å fortsette.");
  if (method !== "GET") {
    sameOrigin(r, e);
    if ((await hash(r.headers.get("X-CSRF-Token") || "")) !== s.csrf_hash)
      fail(403, "CSRF_INVALID", "Last inn siden på nytt.");
  }
  await e.DB.prepare("UPDATE auth_sessions SET idle_expires_at=? WHERE id=?")
    .bind(now + 28800000, s.id)
    .run();
  if (p === "/auth/session") {
    if (method === "DELETE") {
      await e.DB.prepare("DELETE FROM auth_sessions WHERE id=?")
        .bind(s.id)
        .run();
      return json(null, 200, {
        "Set-Cookie":
          "__Host-eos_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      });
    }
    if (method === "GET") {
      if (r.headers.get("Sec-Fetch-Site") === "cross-site")
        fail(403, "ORIGIN_DENIED", "Ugyldig opprinnelse.");
      const csrf = token();
      await e.DB.prepare("UPDATE auth_sessions SET csrf_hash=? WHERE id=?")
        .bind(await hash(csrf), s.id)
        .run();
      return json({ csrf, local: local(r, e) });
    }
  }
  if (p === "/integrations")
    return json([{ provider: "AthleData", status: "disconnected" }]);
  if (method === "GET") {
    if (p === "/profile" || p === "/preferences") {
      const row = await e.DB.prepare(
        `SELECT * FROM ${p === "/profile" ? "athlete_profiles" : "user_preferences"} WHERE user_id='owner'`,
      ).first<any>();
      return json({ ...JSON.parse(row.data), version: row.version });
    }
    if (p === "/goals")
      return json(
        (
          await e.DB.prepare(
            "SELECT * FROM training_goals WHERE user_id='owner' AND archived_at IS NULL",
          ).all<any>()
        ).results.map((x) => ({
          ...JSON.parse(x.data),
          id: x.id,
          version: x.version,
        })),
      );
    if (p === "/templates")
      return json(
        (
          await e.DB.prepare(
            "SELECT * FROM workout_templates WHERE user_id='owner' AND archived_at IS NULL",
          ).all<any>()
        ).results.map((x) => ({
          ...JSON.parse(x.definition_json),
          id: x.id,
          version: x.version,
        })),
      );
    if (
      p === "/analytics/summary" ||
      p === "/workouts" ||
      p === "/calendar" ||
      p.startsWith("/workouts/")
    ) {
      const from = dateSchema.parse(
          url.searchParams.get("from") || "2000-01-01",
        ),
        to = dateSchema.parse(url.searchParams.get("to") || "2100-01-01");
      const id = p.startsWith("/workouts/") ? p.split("/")[2] : null;
      const rows = await e.DB.prepare(
        "SELECT w.*,r.snapshot_json,c.actual_duration_s,c.recorded_at FROM workouts w JOIN workout_revisions r ON r.workout_id=w.id AND r.revision=w.current_revision LEFT JOIN manual_completions c ON c.workout_id=w.id WHERE w.user_id='owner' AND w.deleted_at IS NULL AND w.calendar_date BETWEEN ? AND ? AND (? IS NULL OR w.id=?) ORDER BY w.calendar_date,w.created_at",
      )
        .bind(from, to, id, id)
        .all<any>();
      const data = rows.results.map((x) => ({
        ...JSON.parse(x.snapshot_json),
        id: x.id,
        calendarDate: x.calendar_date,
        version: x.version,
        revision: x.current_revision,
        locked: !!x.locked,
        completedSeconds: x.actual_duration_s,
        completedAt: x.recorded_at
          ? new Date(x.recorded_at).toISOString()
          : null,
      }));
      if (id && !data.length) fail(404, "NOT_FOUND", "Økten finnes ikke.");
      if (p === "/analytics/summary")
        return json({
          plannedSeconds: data.reduce(
            (n, w) => n + (duration(w.steps).seconds || 0),
            0,
          ),
          unknownDurationCount: data.filter(
            (w) => duration(w.steps).seconds === null,
          ).length,
          completedSeconds: data.reduce(
            (n, w) => n + (w.completedSeconds || 0),
            0,
          ),
          completedCount: data.filter((w) => w.completedAt).length,
          plannedCount: data.length,
          source: "manual",
          bySport: Object.fromEntries(
            [...new Set(data.map((w) => w.sport))].map((sport) => [
              sport,
              data
                .filter((w) => w.sport === sport)
                .reduce((n, w) => n + (duration(w.steps).seconds || 0), 0),
            ]),
          ),
        });
      return json(id ? data[0] : data);
    }
    fail(404, "NOT_FOUND", "Siden finnes ikke.");
  }
  const raw = await body(r),
    key = r.headers.get("Idempotency-Key");
  if (!key || !z.string().uuid().safeParse(key).success)
    fail(400, "IDEMPOTENCY_REQUIRED", "Forespørselen mangler nøkkel.");
  const fingerprint = await hash(
    method + p + JSON.stringify(raw) + (r.headers.get("If-Match") || ""),
  );
  const previous = await e.DB.prepare(
    "SELECT * FROM api_idempotency WHERE key=?",
  )
    .bind(key)
    .first<any>();
  if (previous) {
    if (previous.request_hash !== fingerprint)
      fail(409, "IDEMPOTENCY_CONFLICT", "Nøkkelen er allerede brukt.");
    return json(JSON.parse(previous.response_json));
  }
  const statements: D1PreparedStatement[] = [],
    id = p.split("/")[2],
    action = p.split("/")[3];
  let result: any = { ok: true };
  const expected = Number(
    r.headers.get("If-Match")?.replaceAll('"', "").replace("v", ""),
  );
  const guard = (
    table: string,
    where: string,
    args: unknown[],
    unlocked = false,
  ) => {
    if (!expected) fail(428, "VERSION_REQUIRED", "Versjon mangler.");
    statements.push(
      e.DB.prepare(
        `INSERT INTO mutation_guards SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${where} AND version=? ${unlocked ? "AND locked=0" : ""}) THEN 1 ELSE 0 END`,
      ).bind(key, ...args, expected),
    );
  };
  if (p === "/profile" || p === "/preferences") {
    const table = p === "/profile" ? "athlete_profiles" : "user_preferences";
    const data =
      p === "/profile"
        ? profileSchema.parse(raw)
        : z.object({ offlineEnabled: z.boolean() }).strict().parse(raw);
    guard(table, "user_id='owner'", []);
    statements.push(
      e.DB.prepare(
        `UPDATE ${table} SET data=?,version=version+1 WHERE user_id='owner'`,
      ).bind(JSON.stringify(data)),
    );
  } else if (p.startsWith("/goals") || p.startsWith("/templates")) {
    const isGoal = p.startsWith("/goals"),
      table = isGoal ? "training_goals" : "workout_templates",
      column = isGoal ? "data" : "definition_json";
    if (id) {
      guard(table, "id=? AND user_id='owner' AND archived_at IS NULL", [id]);
      if (method === "DELETE")
        statements.push(
          e.DB.prepare(
            `UPDATE ${table} SET archived_at=?,version=version+1 WHERE id=?`,
          ).bind(now, id),
        );
      else {
        const data = isGoal
          ? goalSchema.parse(raw)
          : definitionSchema.parse(raw);
        statements.push(
          e.DB.prepare(
            `UPDATE ${table} SET ${column}=?,version=version+1 WHERE id=?`,
          ).bind(JSON.stringify(data), id),
        );
      }
    } else {
      const data = isGoal ? goalSchema.parse(raw) : definitionSchema.parse(raw),
        newId = crypto.randomUUID();
      statements.push(
        e.DB.prepare(
          `INSERT INTO ${table}(id,user_id,${column}) VALUES(?,'owner',?)`,
        ).bind(newId, JSON.stringify(data)),
      );
      result = { id: newId };
    }
  } else if (p.startsWith("/workouts")) {
    let source: any = null;
    if (id) {
      source = await e.DB.prepare(
        "SELECT w.*,r.snapshot_json FROM workouts w JOIN workout_revisions r ON r.workout_id=w.id AND r.revision=w.current_revision WHERE w.id=? AND user_id='owner' AND deleted_at IS NULL",
      )
        .bind(id)
        .first<any>();
      if (!source) fail(404, "NOT_FOUND", "Økten finnes ikke.");
    }
    if (action === "lock") {
      const locked = z
        .object({ locked: z.boolean() })
        .strict()
        .parse(raw).locked;
      guard("workouts", "id=? AND user_id='owner' AND deleted_at IS NULL", [
        id,
      ]);
      statements.push(
        e.DB.prepare(
          "UPDATE workouts SET locked=?,version=version+1 WHERE id=?",
        ).bind(Number(locked), id),
      );
    } else if (action === "complete") {
      const data = z
        .object({
          actualSeconds: z.number().int().positive().max(172800).nullable(),
        })
        .strict()
        .parse(raw);
      guard("workouts", "id=? AND user_id='owner' AND deleted_at IS NULL", [
        id,
      ]);
      if (data.actualSeconds === null)
        statements.push(
          e.DB.prepare(
            "DELETE FROM manual_completions WHERE workout_id=?",
          ).bind(id),
        );
      else
        statements.push(
          e.DB.prepare(
            "INSERT INTO manual_completions VALUES(?,?,?,?) ON CONFLICT(workout_id) DO UPDATE SET actual_duration_s=excluded.actual_duration_s,recorded_at=excluded.recorded_at",
          ).bind(id, source.current_revision, data.actualSeconds, now),
        );
      statements.push(
        e.DB.prepare("UPDATE workouts SET version=version+1 WHERE id=?").bind(
          id,
        ),
      );
    } else if (method === "DELETE") {
      guard(
        "workouts",
        "id=? AND user_id='owner' AND deleted_at IS NULL",
        [id],
        true,
      );
      statements.push(
        e.DB.prepare(
          "UPDATE workouts SET deleted_at=?,version=version+1 WHERE id=?",
        ).bind(now, id),
      );
    } else {
      const copy = action === "duplicate";
      let data;
      if (action === "move" || copy) {
        const date = z.object({ calendarDate: dateSchema }).strict().parse(raw);
        data = inputSchema.parse({
          ...JSON.parse(source.snapshot_json),
          calendarDate: date.calendarDate,
        });
      } else data = inputSchema.parse(raw);
      const wid = !id || copy ? crypto.randomUUID() : id,
        rev = !id || copy ? 1 : source.current_revision + 1,
        rid = crypto.randomUUID();
      if (id)
        guard(
          "workouts",
          "id=? AND user_id='owner' AND deleted_at IS NULL",
          [id],
          !copy,
        );
      if (!id || copy)
        statements.push(
          e.DB.prepare(
            "INSERT INTO workouts(id,user_id,calendar_date,created_at) VALUES(?,'owner',?,?)",
          ).bind(wid, data.calendarDate, now),
        );
      else
        statements.push(
          e.DB.prepare(
            "UPDATE workouts SET calendar_date=?,current_revision=?,version=version+1 WHERE id=?",
          ).bind(data.calendarDate, rev, wid),
        );
      statements.push(
        e.DB.prepare("INSERT INTO workout_revisions VALUES(?,?,?,?,?)").bind(
          rid,
          wid,
          rev,
          JSON.stringify(data),
          now,
        ),
      );
      const add = (steps: Step[], parent: string | null) =>
        steps.forEach((step, i) => {
          const sid = crypto.randomUUID();
          statements.push(
            e.DB.prepare("INSERT INTO workout_steps VALUES(?,?,?,?,?)").bind(
              sid,
              rid,
              parent,
              i,
              JSON.stringify({ ...step, children: [] }),
            ),
          );
          add(step.children, sid);
        });
      add(data.steps, null);
      result = { id: wid, duration: duration(data.steps) };
    }
  } else fail(404, "NOT_FOUND", "Siden finnes ikke.");
  if (p.startsWith("/templates") && method !== "DELETE") {
    const templateId = id || result.id;
    statements.push(
      e.DB.prepare(
        "INSERT INTO template_versions SELECT ?,id,version,definition_json,? FROM workout_templates WHERE id=?",
      ).bind(crypto.randomUUID(), now, templateId),
    );
  }
  statements.push(
    e.DB.prepare("INSERT INTO api_idempotency VALUES(?,?,?,?)").bind(
      key,
      fingerprint,
      JSON.stringify(result),
      now,
    ),
    e.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(key),
  );
  try {
    await e.DB.batch(statements);
  } catch (err) {
    if (
      String(err).includes("CHECK constraint") ||
      String(err).includes("UNIQUE constraint")
    )
      fail(
        409,
        "VERSION_CONFLICT",
        "Data er endret eller økten er låst. Last inn på nytt.",
      );
    throw err;
  }
  return json(result);
}
export default {
  async fetch(r: Request, e: Env) {
    try {
      return await handle(r, e);
    } catch (err) {
      if (err instanceof z.ZodError)
        return Response.json(
          {
            error: {
              code: "VALIDATION",
              message: "Kontroller feltene og prøv igjen.",
            },
          },
          { status: 422, headers: { "Cache-Control": "no-store" } },
        );
      if (err instanceof ApiError)
        return Response.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status, headers: { "Cache-Control": "no-store" } },
        );
      return Response.json(
        {
          error: { code: "INTERNAL", message: "En feil oppstod. Prøv igjen." },
        },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};
