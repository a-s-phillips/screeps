import { describe, expect, it } from "vitest";
import { checkLevelUp } from "../../src/logging/levelUp";

function mockRoom(name: string, level: number | undefined): Room {
  return {
    name,
    controller: level === undefined ? undefined : { level }
  } as unknown as Room;
}

describe("checkLevelUp", () => {
  it("returns null and records the level on first observation", () => {
    const roomMemory: RoomMemory = {};

    const result = checkLevelUp(mockRoom("W1N1", 1), roomMemory);

    expect(result).toBeNull();
    expect(roomMemory.lastKnownRCL).toBe(1);
  });

  it("returns a level-up event when the level increased since last check", () => {
    const roomMemory: RoomMemory = { lastKnownRCL: 1 };

    const result = checkLevelUp(mockRoom("W1N1", 2), roomMemory);

    expect(result).toEqual({ room: "W1N1", from: 1, to: 2 });
    expect(roomMemory.lastKnownRCL).toBe(2);
  });

  it("returns null when the level is unchanged", () => {
    const roomMemory: RoomMemory = { lastKnownRCL: 2 };

    const result = checkLevelUp(mockRoom("W1N1", 2), roomMemory);

    expect(result).toBeNull();
  });

  it("returns null for a room with no controller", () => {
    const roomMemory: RoomMemory = {};

    const result = checkLevelUp(mockRoom("W1N1", undefined), roomMemory);

    expect(result).toBeNull();
    expect(roomMemory.lastKnownRCL).toBeUndefined();
  });
});
