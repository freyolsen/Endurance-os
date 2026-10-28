import {
  IntegrationError,
  digest,
  lease,
  release,
  guard,
  type IntegrationEnv,
} from "./base";
import { accessToken } from "./oauth";
import {
  openMcp,
  contract,
  argumentsFor,
  returnedId,
  writeTools,
  type Gateway,
} from "./mcp";
import { importPage } from "./activities";
export async function queueWrite(
  e: IntegrationEnv,
  workoutId: string,
  action: "send" | "delete",
  expectedVersion: number,
  key: string,
) {
  const c = await e.DB.prepare(
    "SELECT * FROM integration_connections WHERE id='athledata' AND status='connected'",
  ).first<any>();
  if (!c) throw new IntegrationError("RECONNECT_REQUIRED");
  const w = await e.DB.prepare(
    "SELECT w.*,r.snapshot_json FROM workouts w JOIN workout_revisions r ON r.workout_id=w.id AND r.revision=w.current_revision WHERE w.id=? AND user_id='owner'",
  )
    .bind(workoutId)
    .first<any>();
  if (!w) throw new IntegrationError("WORKOUT_NOT_FOUND", 404);
  const hash = await digest(
    JSON.stringify({ workoutId, action, expectedVersion }),
  );
  const old = await e.DB.prepare(
    "SELECT id,request_hash FROM sync_operations WHERE idempotency_key=?",
  )
    .bind(key)
    .first<any>();
  if (old) {
    if (old.request_hash !== hash)
      throw new IntegrationError("IDEMPOTENCY_CONFLICT");
    return { id: old.id };
  }
  if (w.version !== expectedVersion)
    throw new IntegrationError("VERSION_CONFLICT");
  if (w.deleted_at && action !== "delete")
    throw new IntegrationError("WORKOUT_DELETED");
  const ref = await e.DB.prepare(
    "SELECT * FROM external_workout_refs WHERE workout_id=? AND account_key=? AND state='active'",
  )
    .bind(workoutId, c.account_key)
    .first<any>();
  if (action === "delete" && !ref)
    throw new IntegrationError("NO_OWNED_EXTERNAL_WORKOUT");
  const kind = action === "delete" ? "delete" : ref ? "update" : "create";
  await contract(e, JSON.parse(c.tools_json), writeTools[kind]);
  const id = crypto.randomUUID();
  await e.DB.batch([
    e.DB.prepare(
      "INSERT INTO mutation_guards SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM sync_operations WHERE workout_id=? AND state IN ('queued','in_flight','ambiguous')) AND EXISTS(SELECT 1 FROM workouts WHERE id=? AND version=?) THEN 1 ELSE 0 END",
    ).bind(id, workoutId, workoutId, expectedVersion),
    e.DB.prepare(
      "INSERT INTO sync_operations(id,integration_id,account_key,workout_id,target_revision,kind,state,idempotency_key,request_hash,payload_json,created_at) VALUES(?,'athledata',?,?,?,?,'queued',?,?,?,?)",
    ).bind(
      id,
      c.account_key,
      workoutId,
      w.current_revision,
      kind,
      key,
      hash,
      JSON.stringify({
        definition: JSON.parse(w.snapshot_json),
        externalId: ref?.external_workout_id ?? null,
      }),
      Date.now(),
    ),
    e.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(id),
  ]);
  return { id };
}
export type GatewayFactory = (
  e: IntegrationEnv,
  token: string,
) => Promise<Gateway>;
export async function processWrite(
  e: IntegrationEnv,
  id: string,
  factory: GatewayFactory = openMcp,
) {
  const holder = await lease(e);
  let gateway: Gateway | undefined,
    dispatched = false;
  try {
    const op = await e.DB.prepare(
      "SELECT * FROM sync_operations WHERE id=? AND state='queued'",
    )
      .bind(id)
      .first<any>();
    if (!op) return;
    const unresolved = await e.DB.prepare(
      "SELECT id FROM sync_operations WHERE state IN ('ambiguous','in_flight') LIMIT 1",
    ).first();
    if (unresolved)
      throw new IntegrationError("AMBIGUOUS_OPERATION_REQUIRES_REVIEW");
    const connection = await e.DB.prepare(
      "SELECT account_key FROM integration_connections WHERE id='athledata' AND status='connected'",
    ).first<any>();
    if (connection?.account_key !== op.account_key)
      throw new IntegrationError("ACCOUNT_MISMATCH");
    gateway = await factory(e, await accessToken(e));
    const name = writeTools[op.kind as keyof typeof writeTools];
    const { tool, profile } = await contract(e, gateway.tools, name);
    const context = JSON.parse(op.payload_json);
    const currentRef = await e.DB.prepare(
      "SELECT external_workout_id FROM external_workout_refs WHERE workout_id=? AND account_key=? AND state='active'",
    )
      .bind(op.workout_id, op.account_key)
      .first<{ external_workout_id: string }>();
    if ((currentRef?.external_workout_id ?? null) !== context.externalId)
      throw new IntegrationError("EXTERNAL_ID_CHANGED");
    if (
      op.kind !== "create" &&
      !Object.values(profile.args).includes("externalId")
    )
      throw new IntegrationError("CURRENT_ID_MAPPING_REQUIRED");
    if (op.kind !== "delete" && !profile.resultIdPath)
      throw new IntegrationError("RESULT_ID_MAPPING_REQUIRED");
    const args = argumentsFor(tool, profile, context);
    await e.DB.batch([
      guard(e, id, holder),
      e.DB.prepare(
        "UPDATE sync_operations SET state='in_flight',dispatched_at=? WHERE id=? AND state='queued'",
      ).bind(Date.now(), id),
      e.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(id),
    ]);
    dispatched = true;
    const result = await gateway.call(name, args);
    const externalId =
      op.kind === "delete" ? context.externalId : returnedId(profile, result);
    // Preserve the received ID even if final mapping/fence validation fails.
    await e.DB.prepare("UPDATE sync_operations SET result_json=? WHERE id=?")
      .bind(JSON.stringify({ externalWorkoutId: externalId }), id)
      .run();
    const generation = await e.DB.prepare(
      "SELECT COALESCE(MAX(generation),0)+1 AS next FROM external_workout_refs WHERE workout_id=? AND account_key=?",
    )
      .bind(op.workout_id, op.account_key)
      .first<{ next: number }>();
    const statements = [
      guard(e, id, holder),
      e.DB.prepare(
        "UPDATE external_workout_refs SET state=? WHERE workout_id=? AND account_key=? AND state='active'",
      ).bind(
        op.kind === "delete" ? "deleted" : "superseded",
        op.workout_id,
        op.account_key,
      ),
    ];
    if (op.kind !== "delete")
      statements.push(
        e.DB.prepare(
          "INSERT INTO external_workout_refs VALUES(?,'athledata',?,?,?,?,?,'active',?)",
        ).bind(
          crypto.randomUUID(),
          op.account_key,
          op.workout_id,
          externalId,
          op.target_revision,
          generation!.next,
          Date.now(),
        ),
      );
    statements.push(
      e.DB.prepare(
        "UPDATE sync_operations SET state='succeeded',completed_at=?,last_error_code=NULL WHERE id=?",
      ).bind(Date.now(), id),
      e.DB.prepare(
        "INSERT INTO sync_history VALUES(?,?,'succeeded',NULL,?)",
      ).bind(crypto.randomUUID(), id, Date.now()),
      e.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(id),
    );
    await e.DB.batch(statements);
  } catch (err) {
    const code =
      err instanceof IntegrationError ? err.code : "PROVIDER_FAILURE";
    const state = dispatched
      ? "ambiguous"
      : code === "RECONNECT_REQUIRED"
        ? "blocked_auth"
        : "blocked_capability";
    await e.DB.batch([
      e.DB.prepare(
        "UPDATE sync_operations SET state=?,last_error_code=? WHERE id=? AND state IN ('queued','in_flight')",
      ).bind(state, code, id),
      e.DB.prepare("INSERT INTO sync_history VALUES(?,?,?,?,?)").bind(
        crypto.randomUUID(),
        id,
        state,
        code,
        Date.now(),
      ),
    ]);
  } finally {
    try {
      await gateway?.close();
    } finally {
      await release(e, holder);
    }
  }
}
export async function manualImport(
  e: IntegrationEnv,
  factory: GatewayFactory = openMcp,
) {
  const holder = await lease(e);
  let gateway: Gateway | undefined;
  try {
    const row = await e.DB.prepare(
      "SELECT account_key FROM integration_connections WHERE id='athledata' AND status='connected'",
    ).first<any>();
    if (!row) throw new IntegrationError("RECONNECT_REQUIRED");
    gateway = await factory(e, await accessToken(e));
    const profiles = JSON.parse(e.ATHLEDATA_CONTRACTS_JSON || "{}");
    const name = Object.keys(profiles).find((n) => profiles[n].itemsPath);
    if (!name) throw new IntegrationError("IMPORT_CONTRACT_REVIEW_REQUIRED");
    const { tool, profile } = await contract(e, gateway.tools, name);
    const cursor = await e.DB.prepare(
      "SELECT cursor_json FROM import_cursors WHERE integration_id='athledata'",
    ).first<any>();
    const args = argumentsFor(tool, profile, {
      cursor: cursor ? JSON.parse(cursor.cursor_json) : null,
    });
    const result = await gateway.call(name, args);
    const imported = await importPage(e, row.account_key, profile, result);
    await e.DB.prepare(
      "UPDATE integration_connections SET last_success_at=?,last_error_code=NULL WHERE id='athledata'",
    )
      .bind(Date.now())
      .run();
    return imported;
  } catch (err) {
    await e.DB.prepare(
      "UPDATE integration_connections SET last_error_code=? WHERE id='athledata'",
    )
      .bind(err instanceof IntegrationError ? err.code : "IMPORT_FAILED")
      .run();
    throw err;
  } finally {
    try {
      await gateway?.close();
    } finally {
      await release(e, holder);
    }
  }
}
export async function recoverExpired(e: IntegrationEnv) {
  await e.DB.prepare(
    "UPDATE sync_operations SET state='ambiguous',last_error_code='INTERRUPTED_REQUEST' WHERE state='in_flight' AND dispatched_at<? AND NOT EXISTS(SELECT 1 FROM integration_leases WHERE lease_until>?)",
  )
    .bind(Date.now() - 120000, Date.now())
    .run();
}
