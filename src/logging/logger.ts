import { addLogEntry, serializeBuffer, LogEntry } from "./buffer";

export const LOG_SEGMENT = 0;
const MAX_ENTRIES = 200;
const MAX_SEGMENT_BYTES = 100_000;

let buffer: LogEntry[] = [];

export function log(event: string, data?: object): void {
  buffer = addLogEntry(buffer, { tick: Game.time, event, data }, MAX_ENTRIES);
}

export function flushLogBuffer(): void {
  RawMemory.setActiveSegments([LOG_SEGMENT]);
  RawMemory.segments[LOG_SEGMENT] = serializeBuffer(buffer, MAX_SEGMENT_BYTES);
}

export function resetLogBuffer(): void {
  buffer = [];
}
