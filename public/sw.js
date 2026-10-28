const CACHE = "eos-shell-v1";
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["/icon.svg", "/manifest.webmanifest"])),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (
    u.origin !== self.location.origin ||
    u.pathname.startsWith("/api/") ||
    u.pathname.startsWith("/cdn-cgi/") ||
    event.request.method !== "GET"
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async (r) => {
          if (
            r.ok &&
            !r.redirected &&
            r.headers.get("content-type")?.includes("text/html")
          )
            (await caches.open(CACHE)).put("/", r.clone());
          return r;
        })
        .catch(
          async () =>
            (await caches.match("/")) ||
            new Response("Koble til nettet for å åpne appen første gang.", {
              headers: { "Content-Type": "text/plain;charset=utf-8" },
            }),
        ),
    );
    return;
  }
  if (u.pathname.startsWith("/assets/") || u.pathname === "/icon.svg")
    event.respondWith(
      caches.match(event.request).then(
        (c) =>
          c ||
          fetch(event.request).then(async (r) => {
            if (r.ok && !r.redirected)
              (await caches.open(CACHE)).put(event.request, r.clone());
            return r;
          }),
      ),
    );
});
