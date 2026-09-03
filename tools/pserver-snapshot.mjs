#!/usr/bin/env node
// Snapshots one or more rooms from the official server (terrain, structures,
// sources, minerals, keeper lairs) and replicates them onto the local pserver
// world, under the same room names. Read-only against the official server;
// all writes land only in pserver's data/db.json.
//
// Usage:
//   node tools/pserver-snapshot.mjs [room ...] [--shard shard3] [--overwrite]
//
// Defaults to the official colony's home room + its Source Keeper neighbor
// (see ~/secondbrain note 67v2, CLAUDE.md "Official server room" memory).
//
// How it works: the actual write happens through the private server's admin
// CLI, which the launcher's `screeps-launcher-cli.js` mod exposes as a plain
// HTTP endpoint (POST /cli) on the CLI port. That port isn't published to the
// host by docker-compose, so this script drops the generated JS payload into
// pserver's bind-mounted data dir and runs curl *inside* the container via
// `docker exec` to reach it over the container's own loopback.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const PSERVER_DATA_DIR = path.join(homedir(), "code/screeps/pserver/data");
const PSERVER_CONTAINER = "screeps-pserver";
const PAYLOAD_FILENAME = ".pserver-snapshot-import.js";

const NPC_USER_IDS = new Set(["2", "3"]); // invaders, source keepers
// Object fields that hold an *absolute* game tick on the source server and
// therefore need to be re-based onto pserver's current tick, not copied verbatim.
const TICK_FIELDS = [
  "nextSpawnTime",
  "nextDecayTime",
  "nextRegenerationTime",
  "downgradeTime",
  "safeMode",
  "safeModeCooldown",
  "upgradeBlocked",
  "ageTime",
  "cooldownTime"
];
const EXCLUDE_TYPES = new Set(["creep", "tombstone", "nuke"]);

function parseArgs(argv) {
  const rooms = [];
  let shard = "shard3";
  let overwrite = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shard") {
      shard = argv[++i];
    } else if (argv[i] === "--overwrite") {
      overwrite = true;
    } else {
      rooms.push(argv[i]);
    }
  }
  if (rooms.length === 0) {
    rooms.push("W57N25", "W56N25"); // home room + its SK neighbor
  }
  return { rooms, shard, overwrite };
}

function loadScreepsConfig() {
  return JSON.parse(readFileSync(new URL("../screeps.json", import.meta.url)));
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  const body = await res.json();
  if (!body.ok) {
    throw new Error(`request failed: ${url} -> ${JSON.stringify(body)}`);
  }
  return body;
}

function translateTicks(obj, offset) {
  for (const field of TICK_FIELDS) {
    if (typeof obj[field] === "number") {
      obj[field] += offset;
    }
  }
  // spawning.spawnTime is an absolute tick the processor compares directly against
  // gameTime (see @screeps/engine spawns/tick.js); spawning.needTime is a derived
  // relative display value the processor never reads. Copying either verbatim across
  // servers either jams the spawn forever (stale spawnTime) or is simply wrong
  // (needTime shifted by a tick offset that doesn't apply to it). An in-progress
  // spawn is transient state anyway, so just drop it like the excluded creep types.
  if (obj.spawning) {
    obj.spawning = null;
  }
  return obj;
}

function main() {
  const { rooms, shard, overwrite } = parseArgs(process.argv.slice(2));
  const config = loadScreepsConfig();
  const official = config.main;
  const pserver = config.pserver;

  const officialBase = `${official.protocol}://${official.hostname}${
    official.port && official.port !== 443 ? ":" + official.port : ""
  }`;
  const pserverBase = `${pserver.protocol}://${pserver.hostname}:${pserver.port}`;
  const officialHeaders = { "X-Token": official.token, "X-Username": official.token };
  const pserverHeaders = { "X-Token": pserver.token, "X-Username": pserver.token };

  run(rooms, shard, overwrite, officialBase, officialHeaders, pserverBase, pserverHeaders);
}

async function run(
  rooms,
  shard,
  overwrite,
  officialBase,
  officialHeaders,
  pserverBase,
  pserverHeaders
) {
  console.log(`Fetching ${rooms.join(", ")} from ${officialBase} (${shard})...`);

  const [officialTime, pserverTime, me] = await Promise.all([
    fetchJson(`${officialBase}/api/game/time?shard=${shard}`, officialHeaders),
    fetchJson(`${pserverBase}/api/game/time`, {}),
    fetchJson(`${pserverBase}/api/auth/me`, pserverHeaders)
  ]);
  const tickOffset = pserverTime.time - officialTime.time;
  const pserverUserId = me._id;
  console.log(
    `official tick ${officialTime.time}, pserver tick ${pserverTime.time} (offset ${tickOffset}); pserver user ${pserverUserId}`
  );

  const terrainByRoom = {};
  const objectsByRoom = {};
  for (const room of rooms) {
    const [terrainRes, objectsRes] = await Promise.all([
      fetchJson(
        `${officialBase}/api/game/room-terrain?room=${room}&shard=${shard}&encoded=1`,
        officialHeaders
      ),
      fetchJson(
        `${officialBase}/api/game/room-objects?room=${room}&shard=${shard}`,
        officialHeaders
      )
    ]);
    terrainByRoom[room] = terrainRes.terrain[0].terrain;
    objectsByRoom[room] = objectsRes.objects;
  }

  // Whichever account owns a spawn in the snapshotted rooms is "us" -
  // structures with that user id get remapped to the pserver account.
  const allObjects = Object.values(objectsByRoom).flat();
  const myOfficialUserId = allObjects.find((o) => o.type === "spawn")?.user;
  if (!myOfficialUserId) {
    console.warn(
      "No spawn found in snapshotted rooms - no owned structures will be remapped to the pserver user."
    );
  }

  const roomsDocs = rooms.map((room) => ({
    _id: room,
    status: "normal",
    sourceKeepers: objectsByRoom[room].some((o) => o.type === "keeperLair")
  }));

  const terrainDocs = rooms.map((room) => ({ room, terrain: terrainByRoom[room] }));

  const objectDocs = [];
  for (const room of rooms) {
    for (const raw of objectsByRoom[room]) {
      if (EXCLUDE_TYPES.has(raw.type)) continue;
      const obj = { ...raw };
      delete obj._id;
      translateTicks(obj, tickOffset);
      if (obj.user) {
        if (obj.user === myOfficialUserId) {
          obj.user = pserverUserId;
        } else if (!NPC_USER_IDS.has(obj.user)) {
          console.warn(
            `Dropping unmapped foreign owner on ${obj.type} at ${room} (${obj.x},${obj.y})`
          );
          obj.user = null;
        }
      }
      objectDocs.push(obj);
    }
  }

  const payload = buildCliPayload({ rooms, roomsDocs, terrainDocs, objectDocs, overwrite });
  const payloadPath = path.join(PSERVER_DATA_DIR, PAYLOAD_FILENAME);
  writeFileSync(payloadPath, payload);

  console.log(
    `Importing into pserver (${objectDocs.length} objects across ${rooms.length} room(s))...`
  );
  try {
    const result = execFileSync(
      "docker",
      [
        "exec",
        PSERVER_CONTAINER,
        "curl",
        "-sS",
        "-X",
        "POST",
        "http://localhost:21026/cli",
        "--data-binary",
        `@/screeps/${PAYLOAD_FILENAME}`
      ],
      { encoding: "utf8" }
    );
    console.log(result.trim());
  } finally {
    unlinkSync(payloadPath);
  }
}

function buildCliPayload({ rooms, roomsDocs, terrainDocs, objectDocs, overwrite }) {
  // This string is executed inside the pserver process's CLI sandbox (see
  // node_modules/@screeps/backend/lib/cli/sandbox.js) - `storage` and `map`
  // are provided by that sandbox, not by this script.
  return `
(function() {
  var db = storage.db;
  var rooms = ${JSON.stringify(rooms)};
  var overwrite = ${JSON.stringify(overwrite)};
  var roomsDocs = ${JSON.stringify(roomsDocs)};
  var terrainDocs = ${JSON.stringify(terrainDocs)};
  var objectDocs = ${JSON.stringify(objectDocs)};

  return db.rooms.find({ _id: { $in: rooms } }).then(function(existing) {
    if (existing.length > 0 && !overwrite) {
      return 'ABORTED: room(s) already exist on pserver: ' + existing.map(function(r) { return r._id; }).join(', ') +
        ' - rerun with --overwrite to replace them.';
    }
    return system.pauseSimulation()
      .then(function() {
        return Promise.all([
          db.rooms.removeWhere({ _id: { $in: rooms } }),
          db['rooms.objects'].removeWhere({ room: { $in: rooms } }),
          db['rooms.terrain'].removeWhere({ room: { $in: rooms } }),
        ]);
      })
      .then(function() {
        return Promise.all([
          db.rooms.insert(roomsDocs),
          db['rooms.terrain'].insert(terrainDocs),
          objectDocs.length ? db['rooms.objects'].insert(objectDocs) : Promise.resolve(),
        ]);
      })
      .then(function() { return map.updateTerrainData(); })
      .then(function() { return Promise.all(rooms.map(function(r) { return map.updateRoomImageAssets(r); })); })
      .then(function() { return system.resumeSimulation(); }, function(err) {
        return system.resumeSimulation().then(function() { throw err; });
      })
      .then(function() { return 'DONE: imported ' + rooms.join(', '); });
  });
})()
`;
}

main();
