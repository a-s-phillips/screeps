import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { initSchema } from "../../tools/telemetry/schema.mjs";
import { pruneLogs, dueFor } from "../../tools/telemetry/retention.mjs";

// vite-node's node: builtin handling only special-cases "node:test", stripping
// the prefix from other builtins (like "node:sqlite") and breaking resolution -
// createRequire sidesteps vite-node's import transform entirely.
const require = createRequire(import.meta.url);
const { DatabaseSync }: typeof import("node:sqlite") = require("node:sqlite");
type DatabaseSync = DatabaseSyncType;

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function makeDb() {
  const db = new DatabaseSync(":memory:");
  initSchema(db);
  return db;
}

function insert(db: DatabaseSync, tick: number, event: string, seenAt: number) {
  db.prepare("INSERT INTO logs (tick, event, data, seen_at) VALUES (?, ?, ?, ?)").run(
    tick,
    event,
    null,
    seenAt
  );
}

function remainingTicks(db: DatabaseSync) {
  return (db.prepare("SELECT tick FROM logs ORDER BY tick").all() as { tick: number }[]).map(
    (row) => row.tick
  );
}

describe("pruneLogs", () => {
  it("deletes tick_summary rows older than the tick-summary retention window", () => {
    const db = makeDb();
    insert(db, 1, "tick_summary", NOW - 4 * DAY);
    insert(db, 2, "tick_summary", NOW - 1 * DAY);

    pruneLogs(db, { now: NOW, tickSummaryRetentionMs: 3 * DAY, eventRetentionMs: 30 * DAY });

    expect(remainingTicks(db)).toEqual([2]);
  });

  it("keeps discrete events that are older than the tick-summary window but within the event window", () => {
    const db = makeDb();
    insert(db, 1, "spawn", NOW - 4 * DAY);

    pruneLogs(db, { now: NOW, tickSummaryRetentionMs: 3 * DAY, eventRetentionMs: 30 * DAY });

    expect(remainingTicks(db)).toEqual([1]);
  });

  it("deletes discrete events past the event retention window", () => {
    const db = makeDb();
    insert(db, 1, "error", NOW - 31 * DAY);

    pruneLogs(db, { now: NOW, tickSummaryRetentionMs: 3 * DAY, eventRetentionMs: 30 * DAY });

    expect(remainingTicks(db)).toEqual([]);
  });

  it("keeps rows within both retention windows", () => {
    const db = makeDb();
    insert(db, 1, "tick_summary", NOW - DAY);
    insert(db, 2, "spawn", NOW - DAY);

    pruneLogs(db, { now: NOW, tickSummaryRetentionMs: 3 * DAY, eventRetentionMs: 30 * DAY });

    expect(remainingTicks(db)).toEqual([1, 2]);
  });

  it("returns the total number of rows deleted", () => {
    const db = makeDb();
    insert(db, 1, "tick_summary", NOW - 4 * DAY);
    insert(db, 2, "error", NOW - 31 * DAY);
    insert(db, 3, "spawn", NOW);

    const deleted = pruneLogs(db, {
      now: NOW,
      tickSummaryRetentionMs: 3 * DAY,
      eventRetentionMs: 30 * DAY
    });

    expect(deleted).toBe(2);
  });
});

describe("dueFor", () => {
  it("is true when nothing has run yet", () => {
    expect(dueFor(1000, null, 500)).toBe(true);
  });

  it("is false before the interval has elapsed", () => {
    expect(dueFor(1000, 600, 500)).toBe(false);
  });

  it("is true once the interval has elapsed", () => {
    expect(dueFor(1200, 600, 500)).toBe(true);
  });
});
