import { describe, expect, it } from "vitest";
import { addLogEntry, serializeBuffer, LogEntry } from "../../src/logging/buffer";

function entry(tick: number): LogEntry {
  return { tick, event: "test", data: { tick } };
}

describe("addLogEntry", () => {
  it("appends an entry to the buffer", () => {
    const result = addLogEntry([], entry(1), 10);
    expect(result).toEqual([entry(1)]);
  });

  it("drops the oldest entries once maxEntries is exceeded", () => {
    const buffer = [entry(1), entry(2), entry(3)];

    const result = addLogEntry(buffer, entry(4), 3);

    expect(result).toEqual([entry(2), entry(3), entry(4)]);
  });

  it("does not mutate the input buffer", () => {
    const buffer = [entry(1)];

    addLogEntry(buffer, entry(2), 10);

    expect(buffer).toEqual([entry(1)]);
  });
});

describe("serializeBuffer", () => {
  it("serializes the buffer as JSON", () => {
    const buffer = [entry(1), entry(2)];

    expect(serializeBuffer(buffer, 100_000)).toBe(JSON.stringify(buffer));
  });

  it("drops the oldest entries until the serialized output fits maxBytes", () => {
    const buffer = [entry(1), entry(2), entry(3)];
    const oneEntrySize = JSON.stringify([entry(3)]).length;

    const result = serializeBuffer(buffer, oneEntrySize);

    expect(JSON.parse(result)).toEqual([entry(3)]);
  });

  it("returns an empty array literal when even the newest entry doesn't fit", () => {
    const buffer = [entry(1)];

    expect(serializeBuffer(buffer, 2)).toBe("[]");
  });
});
