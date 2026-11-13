import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync("herdr-app", ["check", root], { stdio: "inherit", timeout: 40000 });
if (result.error) {
  console.error(result.error.code === "ETIMEDOUT"
    ? "Herdr's mod check did not finish within 40 seconds."
    : `Could not run Herdr's mod check: ${result.error.message}`);
}
process.exitCode = result.status ?? 1;
