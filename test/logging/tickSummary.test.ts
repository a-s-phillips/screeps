import { describe, expect, it } from "vitest";
import { buildTickSummary } from "../../src/logging/tickSummary";

function mockRoom(name: string, energyAvailable: number, energyCapacityAvailable: number): Room {
  return { name, energyAvailable, energyCapacityAvailable } as Room;
}

function mockCreep(roomName: string): Creep {
  return { room: { name: roomName } } as Creep;
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
});
