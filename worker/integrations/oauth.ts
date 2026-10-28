import { z } from "zod";
import {
  RESOURCE,
  IntegrationError,
  remote,
  boundedJSON,
  random,
  digest,
  challenge,
  seal,
  unseal,
  lease,
  release,
  guard,
  checkedURL,
  type IntegrationEnv,
} from "./base";
const metadataSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  code_challenge_methods_supported: z.array(z.string()),
  response_types_supported: z.array(z.string()),
  grant_types_supported: z.array(z.string()).optional(),
  scopes_supported: z.array(z.string()).optional(),
  registration_endpoint: z.string().url().optional(),
  revocation_endpoint: z.string().url().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
});
export type Metadata = z.infer<typeof metadataSchema>;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine((s) => s.toLowerCase() === "bearer"),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
});
export type Tokens = z.infer<typeof tokenSchema> & { expires_at: number };
export async function discover(
  e: IntegrationEnv,
  fetcher: typeof fetch = fetch,
): Promise<Metadata> {
  const response = await remote(
    e,
    RESOURCE,
    { headers: { Accept: "application/json, text/event-stream" } },
    fetcher,
  );
  const header = response.headers.get("www-authenticate") || "";
  const address = header.match(/resource_metadata="([^"]+)"/)?.[1];
  const candidates = address
    ? [address]
    : [
        "https://mcp.athletedata.health/.well-known/oauth-protected-resource/mcp",
        "https://mcp.athletedata.health/.well-known/oauth-protected-resource",
      ];
  let resource: any;
  for (const address of candidates) {
    const r = await remote(e, address, {}, fetcher);
    if (r.ok) {
      resource = await boundedJSON(r);
      break;
    }
  }
  if (
    !resource ||
    resource.resource !== RESOURCE ||
    !Array.isArray(resource.authorization_servers) ||
    resource.authorization_servers.length !== 1
  )
    throw new IntegrationError("RESOURCE_METADATA_UNVERIFIED");
  const issuer = new URL(resource.authorization_servers[0]);
  const path = issuer.pathname === "/" ? "" : issuer.pathname;
  const urls = [
    issuer.origin + "/.well-known/oauth-authorization-server" + path,
    issuer.origin + "/.well-known/openid-configuration" + path,
    issuer.href.replace(/\/$/, "") + "/.well-known/openid-configuration",
  ];
  for (const url of [...new Set(urls)]) {
    const r = await remote(e, url, {}, fetcher);
    if (!r.ok) continue;
    const m = metadataSchema.parse(await boundedJSON(r));
    if (
      m.issuer !== resource.authorization_servers[0] ||
      !m.code_challenge_methods_supported.includes("S256") ||
      !m.response_types_supported.includes("code")
    )
      throw new IntegrationError("OAUTH_REQUIREMENTS_UNSUPPORTED");
    return m;
  }
  throw new IntegrationError("AUTH_METADATA_UNAVAILABLE");
}
export async function connect(e: IntegrationEnv, sessionId: string) {
  const metadata = await discover(e);
  if (!e.ATHLEDATA_CLIENT_ID)
    throw new IntegrationError(
      metadata.registration_endpoint
        ? "CLIENT_REGISTRATION_REQUIRED"
        : "PRE_REGISTERED_CLIENT_REQUIRED",
    );
  if (!e.ATHLEDATA_ACCOUNT_KEY)
    throw new IntegrationError("VERIFIED_ACCOUNT_NAMESPACE_REQUIRED");
  const scopes = (e.ATHLEDATA_SCOPES || "").split(" ").filter(Boolean);
  if (
    !scopes.length ||
    !metadata.scopes_supported ||
    scopes.some((s) => !metadata.scopes_supported!.includes(s))
  )
    throw new IntegrationError("VERIFIED_SCOPES_REQUIRED");
  const verifier = random(),
    state = random(),
    id = crypto.randomUUID(),
    callback = e.APP_ORIGIN + "/api/v1/integrations/athledata/callback";
  const encrypted = await seal(e, "pkce:" + id, verifier);
  await e.DB.prepare(
    "INSERT INTO oauth_transactions VALUES(?,?,?,?,?,?,?,NULL)",
  )
    .bind(
      id,
      sessionId,
      await digest(state),
      encrypted,
      JSON.stringify(metadata),
      JSON.stringify(scopes),
      Date.now() + 600000,
    )
    .run();
  const url = new URL(metadata.authorization_endpoint);
  const params = {
    response_type: "code",
    client_id: e.ATHLEDATA_CLIENT_ID,
    redirect_uri: callback,
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
    scope: scopes.join(" "),
    resource: RESOURCE,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v); // Validate authorization host too; browser navigation is not an SSRF bypass.
  checkedURL(e, url.href);
  return { authorizationUrl: url.href };
}
async function exchange(
  e: IntegrationEnv,
  metadata: Metadata,
  form: URLSearchParams,
  fetcher: typeof fetch = fetch,
) {
  const methods = metadata.token_endpoint_auth_methods_supported || [
    "client_secret_basic",
  ];
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  form.set("client_id", e.ATHLEDATA_CLIENT_ID!);
  form.set("resource", RESOURCE);
  if (e.ATHLEDATA_CLIENT_SECRET) {
    if (methods.includes("client_secret_basic"))
      headers.Authorization =
        "Basic " +
        btoa(
          encodeURIComponent(e.ATHLEDATA_CLIENT_ID!) +
            ":" +
            encodeURIComponent(e.ATHLEDATA_CLIENT_SECRET),
        );
    else if (methods.includes("client_secret_post"))
      form.set("client_secret", e.ATHLEDATA_CLIENT_SECRET);
    else throw new IntegrationError("CLIENT_AUTH_METHOD_UNSUPPORTED");
  } else if (!methods.includes("none"))
    throw new IntegrationError("CLIENT_SECRET_REQUIRED");
  const r = await remote(
    e,
    metadata.token_endpoint,
    { method: "POST", headers, body: form.toString() },
    fetcher,
  );
  if (!r.ok) throw new IntegrationError("TOKEN_EXCHANGE_FAILED");
  const t = tokenSchema.parse(await boundedJSON(r));
  return {
    ...t,
    expires_at: Date.now() + (t.expires_in ?? 0) * 1000,
  } satisfies Tokens;
}
export async function callback(e: IntegrationEnv, sessionId: string, url: URL) {
  const state = url.searchParams.get("state"),
    code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.has("error"))
    throw new IntegrationError("OAUTH_CANCELLED_OR_INVALID");
  const row = await e.DB.prepare(
    "UPDATE oauth_transactions SET consumed_at=? WHERE state_hash=? AND session_id=? AND consumed_at IS NULL AND expires_at>? RETURNING *",
  )
    .bind(Date.now(), await digest(state), sessionId, Date.now())
    .first<any>();
  if (!row) throw new IntegrationError("OAUTH_STATE_INVALID");
  try {
    const metadata = metadataSchema.parse(JSON.parse(row.metadata_json));
    if (
      url.searchParams.has("iss") &&
      url.searchParams.get("iss") !== metadata.issuer
    )
      throw new IntegrationError("OAUTH_ISSUER_MISMATCH");
    const verifier = await unseal<string>(e, "pkce:" + row.id, row.pkce_enc);
    const tokens = await exchange(
      e,
      metadata,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: e.APP_ORIGIN + "/api/v1/integrations/athledata/callback",
      }),
    );
    const requested = JSON.parse(row.scopes_json) as string[];
    if (
      tokens.scope &&
      requested.some((s) => !tokens.scope!.split(" ").includes(s))
    )
      throw new IntegrationError("SCOPES_NOT_GRANTED");
    await e.DB.prepare(
      "INSERT OR IGNORE INTO integration_connections(id,user_id,status,updated_at) VALUES('athledata','owner','disconnected',?)",
    )
      .bind(Date.now())
      .run();
    const holder = await lease(e);
    try {
      const old = await e.DB.prepare(
        "SELECT account_key FROM integration_connections WHERE id='athledata'",
      ).first<any>();
      if (old.account_key && old.account_key !== e.ATHLEDATA_ACCOUNT_KEY)
        throw new IntegrationError("ACCOUNT_CHANGE_REQUIRES_REVIEW");
      const id = crypto.randomUUID();
      await e.DB.batch([
        guard(e, id, holder),
        e.DB.prepare(
          "UPDATE integration_connections SET status='connected',account_key=?,credentials_enc=?,credential_version=credential_version+1,metadata_json=?,last_error_code=NULL,updated_at=? WHERE id='athledata'",
        ).bind(
          e.ATHLEDATA_ACCOUNT_KEY!,
          await seal(e, "tokens", tokens),
          JSON.stringify(metadata),
          Date.now(),
        ),
        e.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(id),
      ]);
    } finally {
      await release(e, holder);
    }
  } finally {
    await e.DB.prepare("DELETE FROM oauth_transactions WHERE id=?")
      .bind(row.id)
      .run();
  }
  return { connected: true };
}
// Caller holds the connection lease across refresh and use, preventing rotation races.
export async function accessToken(
  e: IntegrationEnv,
  fetcher: typeof fetch = fetch,
) {
  const row = await e.DB.prepare(
    "SELECT * FROM integration_connections WHERE id='athledata' AND status='connected'",
  ).first<any>();
  if (!row?.credentials_enc) throw new IntegrationError("RECONNECT_REQUIRED");
  let tokens = await unseal<Tokens>(e, "tokens", row.credentials_enc);
  if (tokens.expires_at < Date.now() + 60000) {
    try {
      if (!tokens.refresh_token)
        throw new IntegrationError("RECONNECT_REQUIRED");
      const next = await exchange(
        e,
        JSON.parse(row.metadata_json),
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        }),
        fetcher,
      );
      tokens = {
        ...next,
        refresh_token: next.refresh_token ?? tokens.refresh_token,
      };
      const changed = await e.DB.prepare(
        "UPDATE integration_connections SET credentials_enc=?,credential_version=credential_version+1 WHERE id='athledata' AND credential_version=? AND status='connected'",
      )
        .bind(await seal(e, "tokens", tokens), row.credential_version)
        .run();
      if (changed.meta.changes !== 1)
        throw new IntegrationError("TOKEN_VERSION_CONFLICT");
    } catch {
      await e.DB.prepare(
        "UPDATE integration_connections SET status='reauth_required',last_error_code='REFRESH_UNCERTAIN' WHERE id='athledata' AND credential_version=? AND status='connected'",
      )
        .bind(row.credential_version)
        .run();
      throw new IntegrationError("RECONNECT_REQUIRED");
    }
  }
  return tokens.access_token;
}
export async function disconnect(e: IntegrationEnv) {
  const row = await e.DB.prepare(
    "SELECT * FROM integration_connections WHERE id='athledata'",
  ).first<any>();
  if (!row) return { disconnected: true, remoteRevocation: "not_connected" };
  const holder = await lease(e);
  let revoked = false;
  try {
    await e.DB.batch([
      e.DB.prepare(
        "UPDATE integration_connections SET status='disconnected',credentials_enc=NULL,credential_version=credential_version+1,tools_json='[]' WHERE id='athledata'",
      ),
      e.DB.prepare(
        "UPDATE sync_operations SET state='cancelled' WHERE state='queued'",
      ),
    ]);
    const m = JSON.parse(row.metadata_json);
    if (m.revocation_endpoint && row.credentials_enc) {
      try {
        const t = await unseal<Tokens>(e, "tokens", row.credentials_enc);
        const form = new URLSearchParams({
          token: t.refresh_token || t.access_token,
          client_id: e.ATHLEDATA_CLIENT_ID || "",
        });
        if (e.ATHLEDATA_CLIENT_SECRET)
          form.set("client_secret", e.ATHLEDATA_CLIENT_SECRET);
        revoked = (
          await remote(e, m.revocation_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString(),
          })
        ).ok;
      } catch {
        /* local credentials already removed; report uncertainty */
      }
    }
    return {
      disconnected: true,
      remoteRevocation: revoked ? "confirmed" : "revoke_in_provider_account",
    };
  } finally {
    await release(e, holder);
  }
}
