#!/usr/bin/env node
// Spins up a disposable, from-scratch Screeps private server per experiment -
// seeded precisely for one hypothesis, observed directly via the admin CLI, then
// torn down - instead of routing verification through the persistent pserver
// (~/code/screeps/pserver), which accumulates one-off test scenarios over time
// (cloned replicas, renamed spawns, boxed-in terrain from earlier experiments)
// until it's a worse proxy for official than official itself is. See
// ~/secondbrain "Screeps bot: state of play, 2026-09-04" for the reasoning.
//
// Usage:
//   node tools/ephemeralPserver.mjs up [--name X] [--port 21125]
//   node tools/ephemeralPserver.mjs seed <name> [room ...] [--shard shard3] [--overwrite]
//   node tools/ephemeralPserver.mjs push <name>
//   node tools/ephemeralPserver.mjs eval <name> '<js>'
//   node tools/ephemeralPserver.mjs list
//   node tools/ephemeralPserver.mjs down <name>
//
// `seed` reuses pserver-snapshot.mjs's terrain/structure-cloning logic unchanged,
// just pointed at the named instance via env vars instead of the persistent
// server's screeps.json entry. `eval` is the direct equivalent of the
// `docker exec ... curl .../cli` incantation from CLAUDE.md, for ad hoc state
// checks without a Grafana/telemetry pipeline that would outlive the instance
// anyway. `push` builds and uploads the current bot code the same way
// `npm run push-pserver`/`push-main` do, via a temporary screeps.json entry.
//
// Only the API port needs to be unique per instance (published to the host); the
// CLI port is never published by either server's docker setup, so `eval`/`seed`
// always reach it the same way - `docker exec <container> curl ...` over the
// container's own loopback - no per-instance port bookkeeping needed there.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { runCliCommand } from "./pserverCli.mjs";

const TEMPLATE_DATA_DIR = path.join(homedir(), "code/screeps/pserver/data");
const EPHEMERAL_ROOT = path.join(tmpdir(), "screeps-ephemeral");
const DEFAULT_PORT = 21125;
// Thrown away with the instance - only exists so the seeded room's structures have
// an owner and the pushed bot code has an account to run under.
const CREDENTIALS = { username: "bot", email: "bot@ephemeral.test", password: "ephemeral" };

export function instanceDir(name) {
  return path.join(EPHEMERAL_ROOT, name);
}

export function dataDirFor(name) {
  return path.join(instanceDir(name), "data");
}

export function handlePathFor(name) {
  return path.join(instanceDir(name), "handle.json");
}

export function containerNameFor(name) {
  return `screeps-ephemeral-${name}`;
}

export function generateInstanceName(random = Math.random) {
  return `ephemeral-${Math.floor(random() * 36 ** 6).toString(36)}`;
}

export function buildDockerRunArgs({ containerName, dataDir, port }) {
  return [
    "run",
    "-d",
    "--name",
    containerName,
    "-p",
    `${port}:21025`,
    "-v",
    `${dataDir}:/screeps`,
    "screepers/screeps-launcher"
  ];
}

export function buildDestConfig({ port, token }) {
  return { protocol: "http", hostname: "localhost", port, path: "/", token, branch: "auto" };
}

function readHandle(name) {
  const handlePath = handlePathFor(name);
  if (!existsSync(handlePath)) {
    throw new Error(`no ephemeral instance named "${name}" (looked for ${handlePath})`);
  }
  return JSON.parse(readFileSync(handlePath, "utf8"));
}

async function waitForApiReady(baseUrl, { timeoutMs = 60_000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/game/time`);
      if (res.ok && (await res.json()).ok) return;
    } catch {
      // not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${baseUrl} did not become ready within ${timeoutMs}ms`);
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${url} -> ${JSON.stringify(json)}`);
  return json;
}

async function registerAndMintToken(baseUrl) {
  await postJson(`${baseUrl}/api/register/submit`, CREDENTIALS);
  const signin = await postJson(`${baseUrl}/api/auth/signin`, {
    email: CREDENTIALS.email,
    password: CREDENTIALS.password
  });
  const minted = await postJson(
    `${baseUrl}/api/user/auth-token`,
    {},
    { "X-Token": signin.token, "X-Username": signin.token }
  );
  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { "X-Token": minted.token, "X-Username": minted.token }
  }).then((r) => r.json());
  return { token: minted.token, userId: me._id };
}

async function up({ name, port }) {
  if (existsSync(instanceDir(name))) {
    throw new Error(`${instanceDir(name)} already exists - pick a different --name or run "down" first`);
  }

  const dataDir = dataDirFor(name);
  const containerName = containerNameFor(name);
  console.log(`Provisioning ${name} (container ${containerName}, port ${port})...`);

  mkdirSync(dataDir, { recursive: true });
  // Only db.json (world state) needs to be absent for a genuinely fresh world;
  // node_modules/deps (~445MB, identical across any instance) and config.yml/
  // mods.json (steam key, screepsmod-auth + the CLI mod) are reused as-is - a
  // plain filesystem copy is fast, unlike letting the launcher reinstall them.
  execFileSync("cp", ["-r", `${TEMPLATE_DATA_DIR}/.`, dataDir]);
  for (const stale of ["db.json", "logs", "assets"]) {
    rmSync(path.join(dataDir, stale), { recursive: true, force: true });
  }

  execFileSync("docker", buildDockerRunArgs({ containerName, dataDir, port }));

  const baseUrl = `http://localhost:${port}`;
  console.log("Waiting for the API to come up...");
  await waitForApiReady(baseUrl);

  console.log("Registering a throwaway account and minting a token...");
  const { token, userId } = await registerAndMintToken(baseUrl);

  const handle = { name, containerName, dataDir, port, token, userId, createdAt: new Date().toISOString() };
  writeFileSync(handlePathFor(name), JSON.stringify(handle, null, 2));
  console.log(`Up: ${name}\n${JSON.stringify(handle, null, 2)}`);
  return handle;
}

function seed(name, { rooms, shard, overwrite }) {
  const handle = readHandle(name);
  console.log(`Seeding ${rooms.length ? rooms.join(", ") : "(default rooms)"} into ${name}...`);
  execFileSync(
    "node",
    [
      new URL("./pserver-snapshot.mjs", import.meta.url).pathname,
      ...rooms,
      "--shard",
      shard,
      ...(overwrite ? ["--overwrite"] : [])
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PSERVER_CONTAINER: handle.containerName,
        PSERVER_DATA_DIR: handle.dataDir,
        PSERVER_HOST: "localhost",
        PSERVER_PORT: String(handle.port),
        PSERVER_TOKEN: handle.token
      }
    }
  );
}

// rollup-plugin-screeps' branch:"auto" resolves to the current *local git branch
// name* (see node_modules/rollup-plugin-screeps/dist/screeps-client.js), not the
// target account's active branch. A brand-new account's active branch is whatever
// it was registered with ("default") until explicitly switched - the exact gotcha
// CLAUDE.md documents for the persistent server. Pushing here would otherwise
// silently create and populate a branch nothing ever runs.
async function push(name) {
  const handle = readHandle(name);
  const screepsJsonPath = new URL("../screeps.json", import.meta.url);
  const original = readFileSync(screepsJsonPath, "utf8");
  let branch;
  try {
    const config = JSON.parse(original);
    config.ephemeral = buildDestConfig({ port: handle.port, token: handle.token });
    writeFileSync(screepsJsonPath, JSON.stringify(config, null, 2));
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
    console.log(`Pushing current build to ${name} (port ${handle.port}, branch ${branch})...`);
    execFileSync("npx", ["rollup", "-c"], {
      stdio: "inherit",
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, DEST: "ephemeral" }
    });
  } finally {
    writeFileSync(screepsJsonPath, original);
  }

  console.log(`Activating branch ${branch}...`);
  await postJson(
    `http://localhost:${handle.port}/api/user/set-active-branch`,
    { branch, activeName: "activeWorld" },
    { "X-Token": handle.token, "X-Username": handle.token }
  );
}

function evalCli(name, script) {
  const handle = readHandle(name);
  console.log(runCliCommand(handle.containerName, handle.dataDir, script));
}

function list() {
  if (!existsSync(EPHEMERAL_ROOT)) {
    console.log("No ephemeral instances.");
    return;
  }
  const names = execFileSync("ls", [EPHEMERAL_ROOT], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  if (names.length === 0) {
    console.log("No ephemeral instances.");
    return;
  }
  for (const name of names) {
    try {
      const handle = readHandle(name);
      console.log(`${name}  port=${handle.port}  container=${handle.containerName}  created=${handle.createdAt}`);
    } catch {
      console.log(`${name}  (no handle.json - partially provisioned or already torn down)`);
    }
  }
}

function down(name) {
  const containerName = containerNameFor(name);
  console.log(`Tearing down ${name}...`);
  try {
    execFileSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  } catch {
    // container may already be gone - fall through to directory cleanup regardless
  }
  rmSync(instanceDir(name), { recursive: true, force: true });
  console.log(`Down: ${name}`);
}

const BOOLEAN_FLAGS = new Set(["overwrite"]);

export function parseFlags(argv, booleanFlags = BOOLEAN_FLAGS) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      flags[key] = booleanFlags.has(key) ? true : argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, flags };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  switch (command) {
    case "up":
      await up({ name: flags.name ?? generateInstanceName(), port: Number(flags.port ?? DEFAULT_PORT) });
      break;
    case "seed":
      seed(positional[0], { rooms: positional.slice(1), shard: flags.shard ?? "shard3", overwrite: !!flags.overwrite });
      break;
    case "push":
      await push(positional[0]);
      break;
    case "eval":
      evalCli(positional[0], positional[1]);
      break;
    case "list":
      list();
      break;
    case "down":
      down(positional[0]);
      break;
    default:
      console.error(
        "Usage: node tools/ephemeralPserver.mjs <up|seed|push|eval|list|down> ..."
      );
      process.exit(1);
  }
}

// Guarded so the pure helpers above can be imported (by tests) without also
// triggering the CLI dispatch - only runs when this file is the entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
}
