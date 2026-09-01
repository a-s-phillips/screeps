// Retention policy for telemetry.sqlite. `tick_summary` is emitted once per tick
// and is by far the highest-volume, lowest-information-density event (see
// "Known limitation: no retention policy" in the telemetry secondbrain note), so
// it gets a much shorter retention window than discrete events like `spawn`,
// `error`, `hostile_sighted`, etc.
export function pruneLogs(db, { now = Date.now(), tickSummaryRetentionMs, eventRetentionMs }) {
  const tickSummaryCutoff = now - tickSummaryRetentionMs;
  const eventCutoff = now - eventRetentionMs;

  const tickSummaryDeleted = db
    .prepare("DELETE FROM logs WHERE event = 'tick_summary' AND seen_at < ?")
    .run(tickSummaryCutoff).changes;
  const eventDeleted = db
    .prepare("DELETE FROM logs WHERE event != 'tick_summary' AND seen_at < ?")
    .run(eventCutoff).changes;

  return tickSummaryDeleted + eventDeleted;
}

// Simple recurring-task gate: true if `lastRunAt` is unset or the interval has
// elapsed as of `now`. Shared by the prune and vacuum schedules in the poller.
export function dueFor(now, lastRunAt, intervalMs) {
  return lastRunAt === null || now - lastRunAt >= intervalMs;
}
