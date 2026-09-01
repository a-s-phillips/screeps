#!/usr/bin/env node
// Polls the bot's RawMemory log segment (see src/logging/logger.ts) from a live
// Screeps server and writes each entry into a local SQLite file, so the bot's
// telemetry is queryable outside the game (which has no outbound network access).
import { readFileSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "./schema.mjs";
import { pruneLogs, dueFor } from "./retention.mjs";

const DEST = process.env.SCREEPS_DEST ?? "main";
const SEGMENT = Number(process.env.SCREEPS_LOG_SEGMENT ?? 0);
// Default matches pserver (no rate limiting). The official server caps
// GET /api/user/memory-segment at 360/hour (docs.screeps.com/auth-tokens.html) -
// the "telemetry" npm script overrides this to 15000ms (240/hour) for that reason.
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const SQLITE_PATH = process.env.SQLITE_PATH ?? "./telemetry.sqlite";

// tick_summary is emitted once per tick and dominates row count with low
// per-row information density, so it gets pruned much sooner than discrete
// events (spawn, error, hostile_sighted, construction_site_planned, creep_died, ...).
const TICK_SUMMARY_RETENTION_MS = Number(
  process.env.TICK_SUMMARY_RETENTION_MS ?? 3 * 24 * 60 * 60 * 1000 // 3 days
);
const EVENT_RETENTION_MS = Number(process.env.EVENT_RETENTION_MS ?? 30 * 24 * 60 * 60 * 1000); // 30 days
const PRUNE_INTERVAL_MS = Number(process.env.PRUNE_INTERVAL_MS ?? 60 * 60 * 1000); // 1 hour
const VACUUM_INTERVAL_MS = Number(process.env.VACUUM_INTERVAL_MS ?? 24 * 60 * 60 * 1000); // 1 day

function loadDestConfig() {
  const config = JSON.parse(readFileSync(new URL("../../screeps.json", import.meta.url)));
  const dest = config[DEST];
  if (!dest) throw new Error(`No "${DEST}" entry in screeps.json`);
  return dest;
}

function baseUrl(dest) {
  let url = `${dest.protocol}://${dest.hostname}:${dest.port}${dest.path}`;
  if (!url.endsWith("/")) url += "/";
  return url;
}

async function fetchSegment(dest) {
  const url = new URL(`api/user/memory-segment?segment=${SEGMENT}`, baseUrl(dest));
  if (dest.shard) url.searchParams.set("shard", dest.shard);
  const res = await fetch(url, {
    headers: { "X-Token": dest.token, "X-Username": dest.token }
  });
  if (!res.ok) throw new Error(`memory-segment request failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.data;
}

function openDb() {
  const db = new DatabaseSync(SQLITE_PATH);
  initSchema(db);
  return db;
}

function insertEntries(db, entries) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO logs (tick, event, data, seen_at) VALUES (?, ?, ?, ?)"
  );
  const now = Date.now();
  let inserted = 0;
  for (const entry of entries) {
    const result = insert.run(entry.tick, entry.event, JSON.stringify(entry.data ?? null), now);
    if (result.changes > 0) inserted++;
  }
  return inserted;
}

async function pollOnce(dest, db) {
  const raw = await fetchSegment(dest);
  if (!raw) return 0;

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    console.warn("Segment content is not valid JSON, skipping this poll");
    return 0;
  }

  return insertEntries(db, entries);
}

function maybePrune(db, state) {
  const now = Date.now();
  if (!dueFor(now, state.lastPruneAt, PRUNE_INTERVAL_MS)) return;

  state.lastPruneAt = now;
  const deleted = pruneLogs(db, {
    now,
    tickSummaryRetentionMs: TICK_SUMMARY_RETENTION_MS,
    eventRetentionMs: EVENT_RETENTION_MS
  });
  if (deleted > 0) console.log(`Pruned ${deleted} old log rows`);

  if (deleted > 0 && dueFor(now, state.lastVacuumAt, VACUUM_INTERVAL_MS)) {
    state.lastVacuumAt = now;
    db.exec("VACUUM");
    console.log("Vacuumed telemetry.sqlite");
  }
}

async function main() {
  const dest = loadDestConfig();
  const db = openDb();
  const pruneState = { lastPruneAt: null, lastVacuumAt: null };

  console.log(`Polling ${DEST} segment ${SEGMENT} every ${POLL_INTERVAL_MS}ms -> ${SQLITE_PATH}`);

  for (;;) {
    try {
      const inserted = await pollOnce(dest, db);
      if (inserted > 0) console.log(`+${inserted} log entries`);
      maybePrune(db, pruneState);
    } catch (err) {
      console.error("Poll failed:", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main();
