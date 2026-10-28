import { z } from "zod";
import { IntegrationError, lease, release, type IntegrationEnv } from "./base";
import { connect, callback, disconnect, accessToken } from "./oauth";
import { openMcp } from "./mcp";
import { queueWrite, processWrite, manualImport, recoverExpired } from "./sync";
import { candidates, comparison } from "./activities";
const response = (data: unknown, status = 200) =>
  Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
async function requestBody(r: Request) {
  if (!r.headers.get("Content-Type")?.startsWith("application/json"))
    throw new IntegrationError("CONTENT_TYPE", 415);
  const reader = r.body?.getReader(),
    decoder = new TextDecoder();
  let text = "",
    size = 0;
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        throw new IntegrationError("TOO_LARGE", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new IntegrationError("INVALID_JSON", 400);
  }
}
export async function integrationRoutes(
  r: Request,
  e: IntegrationEnv,
  sessionId: string,
): Promise<Response | null> {
  const u = new URL(r.url),
    p = u.pathname.replace("/api/v1", ""),
    method = r.method;
  if (
    !["/integrations", "/sync/", "/activities"].some((x) => p.startsWith(x)) &&
    !/^\/workouts\/[^/]+\/garmin$/.test(p)
  )
    return null;
  try {
    if (
      (p === "/integrations" || p === "/integrations/athledata/diagnostics") &&
      method === "GET"
    ) {
      const c = await e.DB.prepare(
        "SELECT status,tools_json,last_success_at,last_error_code FROM integration_connections WHERE id='athledata'",
      ).first<any>();
      const missing = [
        "TOKEN_ENCRYPTION_KEY_V1",
        "ATHLEDATA_CLIENT_ID",
        "ATHLEDATA_SCOPES",
        "ATHLEDATA_ACCOUNT_KEY",
      ].filter((k) => !e[k as keyof IntegrationEnv]);
      const status = {
        provider: "AthleData",
        status: c?.status || "disconnected",
        missingSettings: missing,
        toolSchemas: c ? JSON.parse(c.tools_json) : [],
        lastSuccessAt: c?.last_success_at ?? null,
        lastErrorCode: c?.last_error_code ?? null,
        contractConfigured: !!e.ATHLEDATA_CONTRACTS_JSON,
      };
      return response(p === "/integrations" ? [status] : status);
    }
    if (p === "/integrations/athledata/connect" && method === "POST")
      return response(await connect(e, sessionId));
    if (p === "/integrations/athledata/callback" && method === "GET") {
      await callback(e, sessionId, u);
      return new Response(null, {
        status: 303,
        headers: {
          Location: e.APP_ORIGIN + "/?athledata=connected",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (p === "/integrations/athledata" && method === "DELETE")
      return response(await disconnect(e));
    if (p === "/integrations/athledata/discover" && method === "POST") {
      const holder = await lease(e);
      try {
        const mcp = await openMcp(e, await accessToken(e));
        try {
          return response({ tools: mcp.tools });
        } finally {
          await mcp.close();
        }
      } finally {
        await release(e, holder);
      }
    }
    if (p === "/integrations/athledata/sync" && method === "POST")
      return response(await manualImport(e));
    if (/^\/workouts\/[^/]+\/garmin$/.test(p) && method === "POST") {
      const data = z
        .object({ action: z.enum(["send", "delete"]) })
        .strict()
        .parse(await requestBody(r));
      const key = z.string().uuid().parse(r.headers.get("Idempotency-Key"));
      const version = Number(
        r.headers.get("If-Match")?.replaceAll('"', "").replace("v", ""),
      );
      if (!version) throw new IntegrationError("VERSION_REQUIRED", 428);
      const operation = await queueWrite(
        e,
        p.split("/")[2],
        data.action,
        version,
        key,
      );
      await processWrite(e, operation.id);
      return response(operation, 202);
    }
    if (p === "/sync/operations" && method === "GET") {
      await recoverExpired(e);
      return response(
        (
          await e.DB.prepare(
            "SELECT id,workout_id,target_revision,kind,state,last_error_code,created_at,completed_at FROM sync_operations ORDER BY created_at DESC LIMIT 100",
          ).all()
        ).results,
      );
    }
    if (p === "/activities" && method === "GET")
      return response(
        (
          await e.DB.prepare(
            "SELECT id,sport,local_date,elapsed_s,distance_m,version FROM completed_activities WHERE user_id='owner' ORDER BY start_at DESC LIMIT 100",
          ).all()
        ).results,
      );
    const match = p.match(/^\/activities\/([^/]+)(?:\/(matches|link))?$/);
    if (match) {
      const id = match[1];
      if (method === "GET")
        return response(
          match[2] === "matches"
            ? await candidates(e, id)
            : await comparison(e, id),
        );
      if (match[2] === "link" && method === "POST") {
        const b = z
          .object({
            workoutId: z.string().uuid(),
            workoutVersion: z.number().int().positive(),
            plannedRevision: z.number().int().positive(),
          })
          .strict()
          .parse(await requestBody(r));
        const version = Number(
          r.headers.get("If-Match")?.replaceAll('"', "").replace("v", ""),
        );
        const key = crypto.randomUUID();
        await e.DB.batch([
          e.DB.prepare(
            "INSERT INTO mutation_guards SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM completed_activities WHERE id=? AND version=? AND user_id='owner') AND EXISTS(SELECT 1 FROM workouts WHERE id=? AND version=? AND deleted_at IS NULL) THEN 1 ELSE 0 END",
          ).bind(key, id, version, b.workoutId, b.workoutVersion),
          e.DB.prepare(
            "INSERT INTO workout_activity_links VALUES(?,?,?,?,'manual',NULL,?,NULL)",
          ).bind(
            crypto.randomUUID(),
            b.workoutId,
            id,
            b.plannedRevision,
            Date.now(),
          ),
          e.DB.prepare(
            "UPDATE completed_activities SET version=version+1 WHERE id=?",
          ).bind(id),
          e.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(key),
        ]);
        return response(await comparison(e, id));
      }
    }
    return response({ message: "Endepunktet finnes ikke." }, 404);
  } catch (err) {
    const code =
      err instanceof IntegrationError
        ? err.code
        : err instanceof z.ZodError
          ? "VALIDATION"
          : "INTEGRATION_FAILED";
    return Response.json(
      {
        error: {
          code,
          message: `Integrasjonen kunne ikke fullføre: ${code}. Se tilkoblingsdiagnostikk.`,
        },
      },
      {
        status:
          err instanceof IntegrationError
            ? err.status
            : err instanceof z.ZodError
              ? 422
              : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
