// Shared helper for talking to a private server's admin CLI (the launcher's
// `screeps-launcher-cli.js` mod, which exposes @screeps/backend's CLI sandbox as a
// plain HTTP endpoint on the internal CLI port). Used by both pserver-snapshot.mjs
// (the persistent dev server) and ephemeralPserver.mjs (disposable per-experiment
// instances) - same mechanism either way, just pointed at a different container.
//
// That port isn't published to the host by either server's docker setup, so every
// call drops the script into the target's bind-mounted data dir and runs curl
// *inside* the container via `docker exec` to reach it over the container's own
// loopback, exactly as CLAUDE.md documents for manual debugging.
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const PAYLOAD_FILENAME = ".pserver-cli-payload.js";

// script is executed inside the pserver process's CLI sandbox (see
// node_modules/@screeps/backend/lib/cli/sandbox.js) - `storage`/`map`/`system` are
// provided by that sandbox, not by this script. Whatever the script's top-level
// expression resolves to (directly, or via a returned Promise) becomes the response
// body, so most callers end each expression in `.then(r => JSON.stringify(r))`.
export function runCliCommand(containerName, dataDir, script) {
  const payloadPath = path.join(dataDir, PAYLOAD_FILENAME);
  writeFileSync(payloadPath, script);
  try {
    return execFileSync(
      "docker",
      [
        "exec",
        containerName,
        "curl",
        "-sS",
        "-X",
        "POST",
        "http://localhost:21026/cli",
        "--data-binary",
        `@/screeps/${PAYLOAD_FILENAME}`
      ],
      { encoding: "utf8" }
    ).trim();
  } finally {
    unlinkSync(payloadPath);
  }
}
