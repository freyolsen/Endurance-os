import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await page
    .getByRole("heading", { name: "Bygg formen. Dag for dag." })
    .waitFor();
  await page.getByRole("button", { name: "Ny økt", exact: true }).click();
  await page.getByLabel("Navn på økten").fill("Nettlesertest – slettes");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Lagre", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.reload();
  await page
    .getByRole("button", { name: "Innstillinger", exact: true })
    .click();
  const enable = page.getByRole("button", {
    name: "Tillat kalender på enheten",
    exact: true,
  });
  if (await enable.isVisible()) await enable.click();
  await page
    .getByRole("button", { name: "Slå av og slett enhetskopi", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("endurance-offline", 1);
        r.onsuccess = () => {
          const q = r.result
            .transaction("calendar")
            .objectStore("calendar")
            .get("snapshot");
          q.onsuccess = () => {
            resolve(
              q.result?.data?.some(
                (w) => w.title === "Nettlesertest – slettes",
              ),
            );
            r.result.close();
          };
        };
      }),
  );
  await page.context().setOffline(true);
  await page
    .getByText("Frakoblet · Kalenderen er skrivebeskyttet.", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Ny økt", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page
    .getByText("Nettlesertest – slettes", { exact: true })
    .first()
    .waitFor();
  await page.context().setOffline(false);
  await page
    .getByRole("button", { name: "Innstillinger", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Slå av og slett enhetskopi", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tillat kalender på enheten", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText("Nettlesertest – slettes", { exact: true }) })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "Nettlesertest – slettes" })
    .waitFor();
  await page.getByLabel("Faktisk gjennomført · minutter").fill("32");
  await page.getByRole("button", { name: "Marker gjennomført" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile overflow",
  );
  await page
    .getByRole("button")
    .filter({ has: page.getByText("Nettlesertest – slettes", { exact: true }) })
    .first()
    .click();
  await page.getByRole("dialog").getByText("32 min", { exact: true }).waitFor();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Slett økt", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Hjem", exact: true }).click();
  await page.screenshot({ path: "/tmp/endurance-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/endurance-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: login, create, reload persistence, offline read-only cache, calendar, manual completion, mobile overflow, deletion; no browser errors",
  );
} finally {
  await browser.close();
}
