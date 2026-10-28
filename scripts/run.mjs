import { spawn } from "node:child_process";
import { resolve } from "node:path";
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || resolve(".wrangler/config"),
    WRANGLER_LOG_PATH: resolve(".wrangler/logs"),
  },
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  process.stderr.write(error.message);
  process.exit(1);
});
