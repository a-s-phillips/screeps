import { describe, expect, it } from "vitest";
import { buildTickSummary, buildCpuSummary } from "../../src/logging/tickSummary";

function mockRoom(name: string, energyAvailable: number, energyCapacityAvailable: number): Room {
  return { name, energyAvailable, energyCapacityAvailable } as Room;
}

function mockCreep(roomName: string, homeRoom?: string): Creep {
  return { room: { name: roomName }, memory: { homeRoom } } as unknown as Creep;
}

describe("buildTickSummary", () => {
  it("summarizes energy and creep counts per room", () => {
    const rooms = [mockRoom("W1N1", 250, 300)];
    const creeps = { a: mockCreep("W1N1"), b: mockCreep("W1N1"), c: mockCreep("W2N2") };

    const summary = buildTickSummary(rooms, creeps);

    expect(summary).toEqual([
      { room: "W1N1", energyAvailable: 250, energyCapacityAvailable: 300, creepCount: 2 }
    ]);
  });

  it("returns an empty array when there are no visible rooms", () => {
    expect(buildTickSummary([], {})).toEqual([]);
  });

  it("attributes a creep with a homeRoom to that room, not wherever it's currently standing", () => {
    // A remote-mining creep's creep.room.name toggles between its home room and the
    // remote room as it travels - counting raw physical presence turned "creep count"
    // into a square wave (found live: alternating almost every sample between two
    // values) instead of a stable population trend. Attribute by homeRoom when set.
    const rooms = [mockRoom("W1N1", 250, 300)];
    const creeps = {
      home: mockCreep("W1N1"),
      awayButHome: mockCreep("W2N2", "W1N1"),
      unrelated: mockCreep("W2N2")
    };

    const summary = buildTickSummary(rooms, creeps);

    expect(summary[0].creepCount).toBe(2);
  });

  it("still attributes a local (non-remote) creep by its current room, since it has no homeRoom", () => {
    const rooms = [mockRoom("W1N1", 250, 300), mockRoom("W2N2", 250, 300)];
    const creeps = { a: mockCreep("W1N1"), b: mockCreep("W2N2") };

    const summary = buildTickSummary(rooms, creeps);

    expect(summary.find((r) => r.room === "W1N1")?.creepCount).toBe(1);
    expect(summary.find((r) => r.room === "W2N2")?.creepCount).toBe(1);
  });
});

describe("buildCpuSummary", () => {
  it("reads used CPU and bucket from Game.cpu", () => {
    const cpu = { getUsed: () => 4.2, bucket: 8500 } as CPU;

    expect(buildCpuSummary(cpu)).toEqual({ used: 4.2, bucket: 8500 });
  });
});
