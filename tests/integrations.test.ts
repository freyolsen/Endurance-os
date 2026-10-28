import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import {
  seal,
  unseal,
  challenge,
  digest,
  checkedURL,
  lease,
  release,
  type IntegrationEnv,
} from "../worker/integrations/base";
import {
  discover,
  connect,
  callback,
  accessToken,
  disconnect,
} from "../worker/integrations/oauth";
import { queueWrite, processWrite } from "../worker/integrations/sync";
import {
  openMcp,
  type Tool,
  type Gateway,
  argumentsFor,
} from "../worker/integrations/mcp";
import {
  importPage,
  candidates,
  comparison,
} from "../worker/integrations/activities";
import { newStep } from "../shared/domain";
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>, e: IntegrationEnv;
const plan = {
  title: "Synthetic contract fixture",
  sport: "running",
  description: "",
  calendarDate: "2026-10-28",
  intensity: "easy",
  steps: [newStep()],
};
const wid = "00000000-0000-4000-8000-000000000010";
const schema = {
  type: "object",
  properties: { workout: { type: "object" }, workout_id: { type: "string" } },
  additionalProperties: false,
};
const tools: Tool[] = [
  "push_workout_to_watch",
  "update_workout_on_watch",
  "delete_workout_from_watch",
].map((name) => ({ name, inputSchema: schema }));
const metadata = {
  issuer: "https://auth.fixture.invalid",
  authorization_endpoint: "https://auth.fixture.invalid/authorize",
  token_endpoint: "https://auth.fixture.invalid/token",
  revocation_endpoint: "https://auth.fixture.invalid/revoke",
  code_challenge_methods_supported: ["S256"],
  response_types_supported: ["code"],
  scopes_supported: ["fixture:read", "fixture:write"],
  token_endpoint_auth_methods_supported: ["none"],
};
beforeAll(async () => {
  proxy = await getPlatformProxy({ persist: false });
  e = {
    ...(proxy.env as object),
    APP_ORIGIN: "https://app.fixture.invalid",
    TOKEN_ENCRYPTION_KEY_V1: btoa("x".repeat(32)),
    ATHLEDATA_ALLOWED_ORIGINS: "https://auth.fixture.invalid",
    ATHLEDATA_CLIENT_ID: "fixture-client",
    ATHLEDATA_SCOPES: "fixture:read",
    ATHLEDATA_ACCOUNT_KEY: "fixture-account",
  } as IntegrationEnv;
  for (const file of readdirSync("migrations").sort())
    for (const statement of readFileSync("migrations/" + file, "utf8")
      .split(";")
      .filter((s) => s.trim()))
      await e.DB.prepare(statement).run();
  await e.DB.prepare("INSERT INTO users VALUES('owner','fixture',0)").run();
  await e.DB.prepare(
    "INSERT INTO workouts(id,user_id,calendar_date,created_at) VALUES(?,'owner','2026-10-28',0)",
  )
    .bind(wid)
    .run();
  await e.DB.prepare(
    "INSERT INTO workout_revisions(id,workout_id,revision,snapshot_json,created_at) VALUES(?,?,1,?,0)",
  )
    .bind("revision-1", wid, JSON.stringify(plan))
    .run();
  await e.DB.prepare(
    "INSERT INTO auth_sessions VALUES('session','owner','hash','csrf',9999999999999,9999999999999)",
  ).run();
});
beforeEach(async () => {
  for (const table of [
    "sync_history",
    "sync_operations",
    "external_workout_refs",
    "workout_activity_links",
    "activity_sources",
    "activity_revisions",
    "completed_activities",
    "import_cursors",
    "integration_leases",
    "oauth_transactions",
    "integration_connections",
  ])
    await e.DB.prepare("DELETE FROM " + table).run();
  await e.DB.prepare(
    "UPDATE workouts SET current_revision=1,version=1 WHERE id=?",
  )
    .bind(wid)
    .run();
  await e.DB.prepare(
    "DELETE FROM workout_revisions WHERE workout_id=? AND revision>1",
  )
    .bind(wid)
    .run();
  await e.DB.prepare(
    "INSERT INTO integration_connections(id,user_id,status,account_key,credentials_enc,metadata_json,tools_json,updated_at) VALUES('athledata','owner','connected',?,?,?,?,0)",
  )
    .bind(
      "fixture-account",
      await seal(e, "tokens", {
        access_token: "fixture-access-not-real",
        token_type: "Bearer",
        refresh_token: "fixture-refresh-not-real",
        expires_at: Date.now() + 3600000,
      }),
      JSON.stringify(metadata),
      JSON.stringify(tools),
    )
    .run();
  const schemaHash = await digest(
    JSON.stringify({ input: schema, output: null }),
  );
  e.ATHLEDATA_CONTRACTS_JSON = JSON.stringify(
    Object.fromEntries(
      tools.map((t) => [
        t.name,
        {
          schemaHash,
          args:
            t.name === "push_workout_to_watch"
              ? { workout: "definition" }
              : t.name === "update_workout_on_watch"
                ? { workout: "definition", workout_id: "externalId" }
                : { workout_id: "externalId" },
          resultIdPath: "workout_id",
        },
      ]),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => proxy.dispose());
const factory = (call: Gateway["call"]) => async () => ({
  tools,
  call,
  close: async () => {},
});
function oauthFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/mcp"))
      return new Response("", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer resource_metadata="https://mcp.athletedata.health/.well-known/oauth-protected-resource"',
        },
      });
    if (url.includes("oauth-protected-resource"))
      return Response.json({
        resource: "https://mcp.athletedata.health/mcp",
        authorization_servers: [metadata.issuer],
      });
    if (url.includes(".well-known")) return Response.json(metadata);
    if (url.endsWith("/token")) {
      expect(String(init?.body)).toContain("resource=");
      return Response.json({
        access_token: "new-fixture-token",
        refresh_token: "rotated-fixture-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "fixture:read",
      });
    }
    if (url.endsWith("/revoke")) return new Response("", { status: 200 });
    throw Error("unexpected test endpoint");
  });
}
describe("synthetic provider contracts, never live Garmin evidence", () => {
  it("encrypts credentials with purpose binding and S256 known vector", async () => {
    const enc = await seal(e, "tokens", { access_token: "sensitive-fixture" });
    expect(enc).not.toContain("sensitive-fixture");
    expect(await unseal(e, "tokens", enc)).toEqual({
      access_token: "sensitive-fixture",
    });
    await expect(unseal(e, "wrong", enc)).rejects.toThrow();
    expect(await challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(() => checkedURL(e, "https://127.0.0.1/token")).toThrow();
  });
  it("discovers metadata, binds callback to session, exchanges once, encrypts and revokes", async () => {
    const fetcher = oauthFetch();
    vi.stubGlobal("fetch", fetcher);
    expect((await discover(e)).issuer).toBe(metadata.issuer);
    const { authorizationUrl } = await connect(e, "session"),
      url = new URL(authorizationUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const redirect = new URL(
      e.APP_ORIGIN +
        "/api/v1/integrations/athledata/callback?code=fixture-code&state=" +
        url.searchParams.get("state"),
    );
    await expect(callback(e, "different-session", redirect)).rejects.toThrow(
      "OAUTH_STATE_INVALID",
    );
    await callback(e, "session", redirect);
    await expect(callback(e, "session", redirect)).rejects.toThrow(
      "OAUTH_STATE_INVALID",
    );
    const row = await e.DB.prepare(
      "SELECT credentials_enc FROM integration_connections",
    ).first<any>();
    expect(row.credentials_enc).not.toContain("new-fixture-token");
    expect((await disconnect(e)).remoteRevocation).toBe("confirmed");
    expect(
      (
        await e.DB.prepare(
          "SELECT credentials_enc FROM integration_connections",
        ).first<any>()
      ).credentials_enc,
    ).toBeNull();
  });
  it("serializes refresh and enters reauth after uncertain rotating refresh", async () => {
    await e.DB.prepare("UPDATE integration_connections SET credentials_enc=?")
      .bind(
        await seal(e, "tokens", {
          access_token: "fixture",
          token_type: "Bearer",
          refresh_token: "old-fixture",
          expires_at: 0,
        }),
      )
      .run();
    const holder = await lease(e);
    await expect(lease(e)).rejects.toThrow("SYNC_BUSY");
    await expect(
      accessToken(e, async () => {
        throw Error("lost response");
      }),
    ).rejects.toThrow("RECONNECT_REQUIRED");
    expect(
      (
        await e.DB.prepare(
          "SELECT status FROM integration_connections",
        ).first<any>()
      ).status,
    ).toBe("reauth_required");
    await release(e, holder);
  });
  it("creates, updates using current ID, stores replacement lineage, and deletes owned mapping", async () => {
    const calls: any[] = [];
    let seq = 0;
    const gateway = factory(async (name, args) => {
      calls.push({ name, args });
      return { workout_id: ++seq === 1 ? "fixture-101" : "fixture-202" };
    });
    const first = await queueWrite(e, wid, "send", 1, crypto.randomUUID());
    await processWrite(e, first.id, gateway);
    await e.DB.prepare(
      "INSERT INTO workout_revisions(id,workout_id,revision,snapshot_json,created_at) VALUES('revision-2',?,2,?,0)",
    )
      .bind(
        wid,
        JSON.stringify({ ...plan, title: "Synthetic edited revision" }),
      )
      .run();
    await e.DB.prepare(
      "UPDATE workouts SET current_revision=2,version=2 WHERE id=?",
    )
      .bind(wid)
      .run();
    const second = await queueWrite(e, wid, "send", 2, crypto.randomUUID());
    await processWrite(e, second.id, gateway);
    expect(calls[1].name).toBe("update_workout_on_watch");
    expect(calls[1].args.workout_id).toBe("fixture-101");
    expect(calls[1].args.workout.title).toBe("Synthetic edited revision");
    expect(
      (
        await e.DB.prepare(
          "SELECT external_workout_id FROM external_workout_refs WHERE state='active'",
        ).first<any>()
      ).external_workout_id,
    ).toBe("fixture-202");
    expect(
      (await e.DB.prepare("SELECT * FROM external_workout_refs").all()).results,
    ).toHaveLength(2);
    const del = await queueWrite(e, wid, "delete", 2, crypto.randomUUID());
    await processWrite(e, del.id, gateway);
    expect(calls[2].args.workout_id).toBe("fixture-202");
    expect(
      (
        await e.DB.prepare(
          "SELECT * FROM external_workout_refs WHERE state='active'",
        ).all()
      ).results,
    ).toHaveLength(0);
  });
  it("blocks dispatch when an external ID changes after queuing", async () => {
    const first = await queueWrite(e, wid, "send", 1, crypto.randomUUID());
    await processWrite(
      e,
      first.id,
      factory(async () => ({ workout_id: "fixture-original" })),
    );
    const update = await queueWrite(e, wid, "send", 1, crypto.randomUUID());
    await e.DB.prepare(
      "UPDATE external_workout_refs SET external_workout_id='fixture-reconciled' WHERE state='active'",
    ).run();
    const call = vi.fn(async () => ({}));
    await processWrite(e, update.id, factory(call));
    expect(call).not.toHaveBeenCalled();
    expect(
      await e.DB.prepare(
        "SELECT state,last_error_code FROM sync_operations WHERE id=?",
      )
        .bind(update.id)
        .first(),
    ).toMatchObject({
      state: "blocked_capability",
      last_error_code: "EXTERNAL_ID_CHANGED",
    });
  });
  it("deduplicates command keys and never replays ambiguous creates", async () => {
    const key = crypto.randomUUID();
    const op = await queueWrite(e, wid, "send", 1, key);
    expect((await queueWrite(e, wid, "send", 1, key)).id).toBe(op.id);
    const call = vi.fn(async () => {
      throw Error("response lost after provider applied write");
    });
    await processWrite(e, op.id, factory(call));
    await processWrite(e, op.id, factory(call));
    expect(call).toHaveBeenCalledTimes(1);
    expect(
      (
        await e.DB.prepare("SELECT state FROM sync_operations WHERE id=?")
          .bind(op.id)
          .first<any>()
      ).state,
    ).toBe("ambiguous");
    await expect(
      queueWrite(e, wid, "send", 1, crypto.randomUUID()),
    ).rejects.toThrow();
  });
  it("blocks undiscovered or changed tool contracts before dispatch", async () => {
    e.ATHLEDATA_CONTRACTS_JSON = "{}";
    await expect(
      queueWrite(e, wid, "send", 1, crypto.randomUUID()),
    ).rejects.toThrow("PROVIDER_CONTRACT_REVIEW_REQUIRED");
    expect(() =>
      argumentsFor(
        {
          name: "fixture",
          inputSchema: { type: "object", required: ["required"] },
        },
        { schemaHash: "0".repeat(64), args: {} },
        {},
      ),
    ).toThrow("UNSUPPORTED_WORKOUT_TRANSLATION");
  });
  it("imports idempotently, links verified historical IDs and compares actual to immutable plan", async () => {
    const op = await queueWrite(e, wid, "send", 1, crypto.randomUUID());
    await processWrite(
      e,
      op.id,
      factory(async () => ({ workout_id: "fixture-remote" })),
    );
    const profile = {
      schemaHash: "0".repeat(64),
      args: {},
      itemsPath: "activities",
      cursorPath: "cursor",
      originNamespace: "garmin",
      fields: {
        externalId: "id",
        sport: "sport",
        startAt: "start",
        elapsedSeconds: "duration",
        distanceM: "distance",
        plannedExternalId: "planned",
      },
    };
    const result = {
      activities: [
        {
          id: "activity-fixture-1",
          sport: "running",
          start: "2026-10-28T08:00:00Z",
          duration: 660,
          distance: 2000,
          planned: "fixture-remote",
        },
      ],
      cursor: null,
    };
    await importPage(e, "fixture-account", profile, result);
    await importPage(e, "fixture-account", profile, result);
    const activities = await e.DB.prepare(
      "SELECT * FROM completed_activities",
    ).all<any>();
    expect(activities.results).toHaveLength(1);
    expect(
      (await e.DB.prepare("SELECT * FROM workout_activity_links").all())
        .results,
    ).toHaveLength(1);
    const comp = await comparison(e, activities.results[0].id);
    expect(comp.comparison).toEqual({
      plannedSeconds: 600,
      actualSeconds: 660,
      deltaSeconds: 60,
    });
    expect(comp.plannedRevision).toBe(1);
    expect(
      (await e.DB.prepare("PRAGMA foreign_key_check").all()).results,
    ).toHaveLength(0);
  });
  it("keeps date-only fallback matching manual and preserves missing metrics", async () => {
    const profile = {
      schemaHash: "0".repeat(64),
      args: {},
      itemsPath: "items",
      originNamespace: "fixture",
      fields: { externalId: "id", sport: "sport", startAt: "start" },
    };
    await importPage(e, "fixture-account", profile, {
      items: [
        {
          id: "missing-fixture",
          sport: "running",
          start: "2026-10-28T08:00:00Z",
        },
      ],
    });
    const a = await e.DB.prepare(
      "SELECT * FROM completed_activities",
    ).first<any>();
    expect(a.elapsed_s).toBeNull();
    expect((await candidates(e, a.id))[0]).toMatchObject({
      score: 0.35,
      requiresApproval: true,
    });
  });
  it("performs real SDK initialize/list/call against mocked HTTP transport", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_input: any, init: any) => {
      if (init?.method !== "POST") return new Response("", { status: 405 });
      const request = JSON.parse(init.body);
      seen.push(request.method);
      if (!("id" in request)) return new Response(null, { status: 202 });
      const result =
        request.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : request.method === "tools/list"
            ? { tools }
            : request.method === "tools/call"
              ? {
                  content: [
                    { type: "text", text: '{"workout_id":"sdk-fixture"}' },
                  ],
                }
              : {};
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    });
    const gateway = await openMcp(e, "fixture-token");
    expect(
      await gateway.call("push_workout_to_watch", { workout: plan }),
    ).toEqual({ workout_id: "sdk-fixture" });
    await gateway.close();
    expect(seen).toContain("initialize");
    expect(seen).toContain("tools/list");
    expect(seen).toContain("tools/call");
  });
});
