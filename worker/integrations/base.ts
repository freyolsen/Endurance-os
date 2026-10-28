export interface IntegrationEnv {
  DB: D1Database;
  APP_ORIGIN: string;
  TOKEN_ENCRYPTION_KEY_V1?: string;
  ATHLEDATA_ALLOWED_ORIGINS?: string;
  ATHLEDATA_CLIENT_ID?: string;
  ATHLEDATA_CLIENT_SECRET?: string;
  ATHLEDATA_SCOPES?: string;
  ATHLEDATA_ACCOUNT_KEY?: string;
  ATHLEDATA_CONTRACTS_JSON?: string;
}
export const RESOURCE = "https://mcp.athletedata.health/mcp";
export class IntegrationError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export const random = () => crypto.randomUUID() + crypto.randomUUID();
export const digest = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function challenge(verifier: string) {
  return b64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export async function seal(e: IntegrationEnv, purpose: string, value: unknown) {
  if (!e.TOKEN_ENCRYPTION_KEY_V1)
    throw new IntegrationError("ENCRYPTION_KEY_REQUIRED", 503);
  const key = bytes(e.TOKEN_ENCRYPTION_KEY_V1);
  if (key.length !== 32)
    throw new IntegrationError("INVALID_ENCRYPTION_KEY", 503);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: new TextEncoder().encode("owner:athledata:" + purpose),
    },
    k,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({
    keyId: "v1",
    nonce: b64(nonce),
    ciphertext: b64(new Uint8Array(ciphertext)),
  });
}
export async function unseal<T>(
  e: IntegrationEnv,
  purpose: string,
  enc: string,
): Promise<T> {
  if (!e.TOKEN_ENCRYPTION_KEY_V1)
    throw new IntegrationError("ENCRYPTION_KEY_REQUIRED", 503);
  const envelope = JSON.parse(enc);
  if (envelope.keyId !== "v1") throw new IntegrationError("UNKNOWN_KEY");
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(e.TOKEN_ENCRYPTION_KEY_V1),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes(envelope.nonce),
          additionalData: new TextEncoder().encode(
            "owner:athledata:" + purpose,
          ),
        },
        key,
        bytes(envelope.ciphertext),
      ),
    ),
  );
}
export function checkedURL(e: IntegrationEnv, address: string) {
  const u = new URL(address);
  const allowed = new Set([
    new URL(RESOURCE).origin,
    ...(e.ATHLEDATA_ALLOWED_ORIGINS || "").split(",").filter(Boolean),
  ]);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    !allowed.has(u.origin) ||
    !u.hostname.includes(".") ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname)
  )
    throw new IntegrationError("UNREVIEWED_PROVIDER_ORIGIN");
  return u;
}
export async function remote(
  e: IntegrationEnv,
  address: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  const u = checkedURL(e, address);
  try {
    return await fetcher(u, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new IntegrationError("PROVIDER_NETWORK", 502);
  }
}
export async function boundedJSON(r: Response) {
  const reader = r.body?.getReader();
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1048576) {
        await reader.cancel();
        throw new IntegrationError("PROVIDER_RESPONSE_TOO_LARGE", 502);
      }
      text += decoder.decode(value, { stream: true });
    }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrationError("PROVIDER_INVALID_JSON", 502);
  }
}
export async function lease(e: IntegrationEnv) {
  const holder = random(),
    now = Date.now();
  const r = await e.DB.prepare(
    "INSERT INTO integration_leases VALUES('athledata',?,?) ON CONFLICT(integration_id) DO UPDATE SET holder=excluded.holder,lease_until=excluded.lease_until WHERE integration_leases.lease_until<? RETURNING holder",
  )
    .bind(holder, now + 120000, now)
    .first<{ holder: string }>();
  if (!r) throw new IntegrationError("SYNC_BUSY");
  return holder;
}
export async function release(e: IntegrationEnv, holder: string) {
  await e.DB.prepare(
    "DELETE FROM integration_leases WHERE integration_id='athledata' AND holder=?",
  )
    .bind(holder)
    .run();
}
export function guard(e: IntegrationEnv, id: string, holder: string) {
  return e.DB.prepare(
    "INSERT INTO mutation_guards SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM integration_leases WHERE integration_id='athledata' AND holder=? AND lease_until>?) THEN 1 ELSE 0 END",
  ).bind(id, holder, Date.now());
}
