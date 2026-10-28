import { readFileSync } from "node:fs";
const config = JSON.parse(
  readFileSync("wrangler.jsonc", "utf8").replace(/,\s*([}\]])/g, "$1"),
);
const prod = config.env?.production,
  vars = { ...prod?.vars, ...process.env },
  missing = [];
if (
  !prod?.d1_databases?.[0]?.database_id ||
  prod.d1_databases[0].database_id.startsWith("00000000-")
)
  missing.push("production D1 database_id");
if (
  !vars.APP_ORIGIN?.startsWith("https://") ||
  vars.APP_ORIGIN.includes(".invalid")
)
  missing.push("APP_ORIGIN: real private HTTPS origin");
for (const name of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "OWNER_ACCESS_SUB"])
  if (!vars[name]) missing.push(name);
if (vars.AUTH_MODE !== "access") missing.push("AUTH_MODE=access");
if (config.workers_dev !== false || config.preview_urls !== false)
  missing.push("disable unprotected alternate hostnames");
console.log(
  missing.length
    ? "BLOCKED: " + missing.join("; ")
    : "Static production prerequisites present. Still verify Access policy and remote migration state before any authorized deployment.",
);
process.exitCode = missing.length ? 1 : 0;
