#!/usr/bin/env node
// Polls the bot's RawMemory log segment (see src/logging/logger.ts) from a live
// Screeps server and writes each entry into a local SQLite file, so the bot's
// telemetry is queryable outside the game (which has no outbound network access).
import { readFileSync } from "fs";
import { DatabaseSync } from "node:sqlite";

const DEST = process.env.SCREEPS_DEST ?? "main";
const SEGMENT = Number(process.env.SCREEPS_LOG_SEGMENT ?? 0);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const SQLITE_PATH = process.env.SQLITE_PATH ?? "./telemetry.sqlite";

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      event TEXT NOT NULL,
      data TEXT,
      seen_at INTEGER NOT NULL,
      UNIQUE(tick, event, data)
    )
  `);
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

async function main() {
  const dest = loadDestConfig();
  const db = openDb();

  console.log(`Polling ${DEST} segment ${SEGMENT} every ${POLL_INTERVAL_MS}ms -> ${SQLITE_PATH}`);

  for (;;) {
    try {
      const inserted = await pollOnce(dest, db);
      if (inserted > 0) console.log(`+${inserted} log entries`);
    } catch (err) {
      console.error("Poll failed:", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main();
