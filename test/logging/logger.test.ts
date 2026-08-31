import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, flushLogBuffer, resetLogBuffer, LOG_SEGMENT } from "../../src/logging/logger";

describe("logger", () => {
  beforeEach(() => {
    resetLogBuffer();
    vi.stubGlobal("Game", { time: 100 });
    vi.stubGlobal("RawMemory", { segments: {}, setActiveSegments: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("activates the log segment and writes buffered entries on flush", () => {
    log("spawn", { role: "harvester" });

    flushLogBuffer();

    expect(RawMemory.setActiveSegments).toHaveBeenCalledWith([LOG_SEGMENT]);
    const written = JSON.parse(RawMemory.segments[LOG_SEGMENT]);
    expect(written).toEqual([{ tick: 100, event: "spawn", data: { role: "harvester" } }]);
  });

  it("accumulates entries across multiple log calls before a flush", () => {
    log("spawn", { role: "harvester" });
    log("spawn", { role: "upgrader" });

    flushLogBuffer();

    const written = JSON.parse(RawMemory.segments[LOG_SEGMENT]);
    expect(written).toHaveLength(2);
  });

  it("does not clear the buffer after a flush, so a slow poller doesn't miss entries", () => {
    log("spawn", { role: "harvester" });
    flushLogBuffer();

    log("spawn", { role: "upgrader" });
    flushLogBuffer();

    const written = JSON.parse(RawMemory.segments[LOG_SEGMENT]);
    expect(written).toEqual([
      { tick: 100, event: "spawn", data: { role: "harvester" } },
      { tick: 100, event: "spawn", data: { role: "upgrader" } }
    ]);
  });
});
