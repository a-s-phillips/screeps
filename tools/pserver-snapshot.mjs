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
// HTTP endpoint (POST /cli) on the CLI port - see pserverCli.mjs for how this
// script (and ephemeralPserver.mjs) reach it.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { runCliCommand } from "./pserverCli.mjs";

// Overridable via env so ephemeralPserver.mjs can point this same, already-proven
// scenario-seeding logic at a disposable instance instead of the persistent one -
// unset, behavior is identical to before these existed.
const PSERVER_DATA_DIR = process.env.PSERVER_DATA_DIR ?? path.join(homedir(), "code/screeps/pserver/data");
const PSERVER_CONTAINER = process.env.PSERVER_CONTAINER ?? "screeps-pserver";

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

// Same override pattern as PSERVER_DATA_DIR/PSERVER_CONTAINER above - lets
// ephemeralPserver.mjs point this at a freshly-provisioned instance's own API
// instead of the persistent server's screeps.json entry.
function resolvePserverConfig() {
  if (!process.env.PSERVER_HOST) return loadScreepsConfig().pserver;
  return {
    protocol: "http",
    hostname: process.env.PSERVER_HOST,
    port: Number(process.env.PSERVER_PORT ?? 21025),
    token: process.env.PSERVER_TOKEN
  };
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
  const official = loadScreepsConfig().main;
  const pserver = resolvePserverConfig();

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

  const payload = buildCliPayload({
    rooms,
    roomsDocs,
    terrainDocs,
    objectDocs,
    overwrite,
    pserverUserId
  });

  console.log(
    `Importing into pserver (${objectDocs.length} objects across ${rooms.length} room(s))...`
  );
  console.log(runCliCommand(PSERVER_CONTAINER, PSERVER_DATA_DIR, payload));
}

function buildCliPayload({ rooms, roomsDocs, terrainDocs, objectDocs, overwrite, pserverUserId }) {
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
  var pserverUserId = ${JSON.stringify(pserverUserId)};

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
      // Game.spawns is name-keyed, not id-keyed - a cloned spawn that keeps its
      // original name collides with any other spawn the same pserver account
      // already owns elsewhere (real Screeps prevents this at spawn-creation time;
      // a raw DB insert bypasses that check entirely). Found live: W57N25 and W9N8
      // both ended up with a spawn named "Spawn1" under the same account, and
      // Game.spawns could only ever expose one of them - the other's room silently
      // never spawned again, with no error anywhere, until the collision was found
      // and one spawn renamed by hand. Renaming on import, before anything is ever
      // inserted, closes the gap instead of relying on catching it after the fact.
      .then(function() {
        if (!pserverUserId) return;
        return db['rooms.objects'].find({ type: 'spawn', user: pserverUserId }).then(function(existingSpawns) {
          var usedNames = {};
          existingSpawns.forEach(function(s) { usedNames[s.name] = true; });
          objectDocs.forEach(function(obj) {
            if (obj.type !== 'spawn' || obj.user !== pserverUserId) return;
            if (!usedNames[obj.name]) {
              usedNames[obj.name] = true;
              return;
            }
            var renamed = obj.name + '_' + obj.room;
            while (usedNames[renamed]) {
              renamed = obj.name + '_' + obj.room + '_' + Math.floor(Math.random() * 10000);
            }
            obj.name = renamed;
            usedNames[renamed] = true;
          });
        });
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
