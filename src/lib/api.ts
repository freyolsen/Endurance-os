let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
  version?: number,
): Promise<T> {
  if (method !== "GET" && !navigator.onLine)
    throw new Error("Endringer krever nettilkobling.");
  const res = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(method !== "GET"
        ? {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": crypto.randomUUID(),
          }
        : {}),
      ...(version ? { "If-Match": `"v${version}"` } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(data ?? {}),
  });
  const payload = (await res.json()) as {
    data: T;
    error?: { message: string };
  };
  if (!res.ok)
    throw new Error(payload.error?.message || "Kunne ikke laste data");
  return payload.data;
}
