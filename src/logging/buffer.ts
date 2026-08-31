export interface LogEntry {
  tick: number;
  event: string;
  data?: object;
}

export function addLogEntry(buffer: LogEntry[], entry: LogEntry, maxEntries: number): LogEntry[] {
  const next = [...buffer, entry];
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
}

export function serializeBuffer(buffer: LogEntry[], maxBytes: number): string {
  let entries = buffer;

  while (entries.length > 0 && JSON.stringify(entries).length > maxBytes) {
    entries = entries.slice(1);
  }

  const serialized = JSON.stringify(entries);
  return serialized.length <= maxBytes ? serialized : "[]";
}
