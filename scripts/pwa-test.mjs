import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const root = resolve("dist/client");
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    res.writeHead(401, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end('{"error":{"message":"Fixture authentication required"}}');
    return;
  }
  try {
    const name = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const path = resolve(root, "." + name);
    if (!path.startsWith(root + "/")) throw Error();
    const data = await readFile(path);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".webmanifest": "application/manifest+json",
          ".png": "image/png",
          ".svg": "image/svg+xml",
        }[extname(path)] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const keys = await page.evaluate(async () => {
    const c = await caches.open("eos-shell-v2");
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  assert(keys.includes("/"));
  assert(keys.some((k) => k.startsWith("/assets/")));
  assert(!keys.some((k) => k.startsWith("/api/")));
  await page.context().setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Logg inn", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "nb");
  console.log(
    "PASS: production shell install, cached assets, offline cold reload, API cache exclusion. Chromium only; physical Safari remains unverified.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
