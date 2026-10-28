import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import worker, { type Env } from "../worker/index";
import { newStep } from "../shared/domain";
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>,
  env: Env,
  cookie = "",
  csrf = "";
const call = async (
  path: string,
  method = "GET",
  data?: unknown,
  version?: number,
  headers: Record<string, string> = {},
) =>
  worker.fetch(
    new Request("http://127.0.0.1:5173/api/v1" + path, {
      method,
      headers: {
        Origin: "http://127.0.0.1:5173",
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": crypto.randomUUID(),
        ...(version ? { "If-Match": `"v${version}"` } : {}),
        ...headers,
      },
      body: method === "GET" ? undefined : JSON.stringify(data ?? {}),
    }),
    env,
  );
const payload = async (r: Response) => ((await r.json()) as any).data;
beforeAll(async () => {
  proxy = await getPlatformProxy({ persist: false });
  env = {
    ...(proxy.env as object),
    AUTH_MODE: "local",
    APP_ORIGIN: "http://127.0.0.1:5173",
  } as Env;
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync("migrations/" + file, "utf8")
      .split(";")
      .filter((s) => s.trim()))
      await env.DB.prepare(sql).run();
});
afterAll(async () => proxy?.dispose());
describe("D1 authenticated API", () => {
  it("rejects anonymous data and cross-origin login", async () => {
    expect((await call("/workouts")).status).toBe(401);
    expect(
      (
        await call("/auth/session", "POST", {}, undefined, {
          Origin: "https://evil.invalid",
        })
      ).status,
    ).toBe(403);
  });
  it("creates HttpOnly Secure session", async () => {
    const r = await call("/auth/session", "POST", {});
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain(
      "HttpOnly; Secure; SameSite=Lax",
    );
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    csrf = (await payload(r)).csrf;
  });
  it("rejects CSRF and invalid data", async () => {
    expect(
      (
        await call("/workouts", "POST", {}, undefined, {
          "X-CSRF-Token": "bad",
        })
      ).status,
    ).toBe(403);
    expect((await call("/workouts", "POST", {})).status).toBe(422);
  });
  it("persists, edits, moves, duplicates, locks and soft-deletes revisions", async () => {
    const input = {
      title: "Testøkt",
      sport: "running",
      description: "",
      intensity: "easy",
      calendarDate: "2026-10-28",
      steps: [newStep()],
    };
    const r = await call("/workouts", "POST", input);
    expect(r.status).toBe(200);
    const { id } = await payload(r);
    let w = await payload(await call("/workouts/" + id));
    expect(w.title).toBe("Testøkt");
    expect(
      (
        await call(
          "/workouts/" + id,
          "PUT",
          { ...input, title: "Oppdatert" },
          w.version,
        )
      ).status,
    ).toBe(200);
    expect((await call("/workouts/" + id, "PUT", input, 1)).status).toBe(409);
    w = await payload(await call("/workouts/" + id));
    expect(
      (
        await call(
          "/workouts/" + id + "/move",
          "POST",
          { calendarDate: "2026-10-30" },
          w.version,
        )
      ).status,
    ).toBe(200);
    w = await payload(await call("/workouts/" + id));
    const duplicate = await payload(
      await call(
        "/workouts/" + id + "/duplicate",
        "POST",
        { calendarDate: "2026-11-01" },
        w.version,
      ),
    );
    expect(duplicate.id).not.toBe(id);
    expect(
      (
        await call(
          "/workouts/" + id + "/complete",
          "POST",
          { actualSeconds: 720 },
          w.version,
        )
      ).status,
    ).toBe(200);
    w = await payload(await call("/workouts/" + id));
    expect(w.completedSeconds).toBe(720);
    expect(
      (
        await call(
          "/workouts/" + id + "/lock",
          "PATCH",
          { locked: true },
          w.version,
        )
      ).status,
    ).toBe(200);
    w = await payload(await call("/workouts/" + id));
    expect(
      (await call("/workouts/" + id, "DELETE", {}, w.version)).status,
    ).toBe(409);
    expect(
      (
        await call(
          "/workouts/" + id + "/lock",
          "PATCH",
          { locked: false },
          w.version,
        )
      ).status,
    ).toBe(200);
    w = await payload(await call("/workouts/" + id));
    expect(
      (await call("/workouts/" + id, "DELETE", {}, w.version)).status,
    ).toBe(200);
    expect((await call("/workouts/" + id)).status).toBe(404);
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM workout_revisions WHERE workout_id=?",
        )
          .bind(id)
          .all()
      ).results.length,
    ).toBe(3);
    expect(
      (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
    ).toHaveLength(0);
  });
  it("deduplicates repeated creates and rejects changed payload", async () => {
    const key = crypto.randomUUID(),
      data = {
        title: "Samme økt",
        sport: "cycling",
        description: "",
        intensity: "easy",
        calendarDate: "2026-10-28",
        steps: [],
      };
    const a = await payload(
      await call("/workouts", "POST", data, undefined, {
        "Idempotency-Key": key,
      }),
    );
    const b = await payload(
      await call("/workouts", "POST", data, undefined, {
        "Idempotency-Key": key,
      }),
    );
    expect(a.id).toBe(b.id);
    expect(
      (
        await call(
          "/workouts",
          "POST",
          { ...data, title: "Annen" },
          undefined,
          { "Idempotency-Key": key },
        )
      ).status,
    ).toBe(409);
  });
  it("persists template CRUD and profile settings", async () => {
    const data = {
      title: "Mal",
      sport: "running",
      description: "",
      intensity: "easy",
      steps: [newStep()],
    };
    const { id } = await payload(await call("/templates", "POST", data));
    expect(
      (await call("/templates/" + id, "PUT", { ...data, title: "Ny mal" }, 1))
        .status,
    ).toBe(200);
    expect((await payload(await call("/templates")))[0].title).toBe("Ny mal");
    expect((await call("/templates/" + id, "DELETE", {}, 2)).status).toBe(200);
    expect(await payload(await call("/templates"))).toHaveLength(0);
    expect(
      (
        await call(
          "/profile",
          "PATCH",
          { maxHr: 185, ftp: 240, pb10k: 2440 },
          1,
        )
      ).status,
    ).toBe(200);
    expect((await payload(await call("/profile"))).ftp).toBe(240);
  });
  it("expires sessions and fails closed for production identity", async () => {
    const old = env.AUTH_MODE;
    env.AUTH_MODE = "access";
    expect((await call("/profile")).status).toBe(503);
    env.AUTH_MODE = old;
    await env.DB.prepare("UPDATE auth_sessions SET expires_at=0").run();
    expect((await call("/profile")).status).toBe(401);
  });
});
