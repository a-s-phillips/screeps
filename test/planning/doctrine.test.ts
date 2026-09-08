import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkColonizeDoctrineComplete } from "../../src/planning/doctrine";
import { resetRoomCache } from "../../src/utils/roomCache";

function mockRoom(name: string, spawnCount: number): Room {
  return {
    name,
    find: vi.fn((type: FindConstant) =>
      type === FIND_MY_SPAWNS ? Array.from({ length: spawnCount }, (_, i) => ({ id: `spawn${i}` })) : []
    )
  } as unknown as Room;
}

describe("checkColonizeDoctrineComplete", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing under the econ doctrine, even with a claim target and a built spawn", () => {
    vi.stubGlobal("Game", { rooms: { W57N24: mockRoom("W57N24", 1) } });
    const memory: RoomMemory = { doctrine: "econ", claimTarget: "W57N24" };

    const result = checkColonizeDoctrineComplete("W57N25", memory);

    expect(result).toBeNull();
    expect(memory.doctrine).toBe("econ");
  });

  it("does nothing under colonize doctrine with no claim target set", () => {
    vi.stubGlobal("Game", { rooms: {} });
    const memory: RoomMemory = { doctrine: "colonize" };

    const result = checkColonizeDoctrineComplete("W57N25", memory);

    expect(result).toBeNull();
    expect(memory.doctrine).toBe("colonize");
  });

  it("does nothing while the claim target has no vision yet", () => {
    vi.stubGlobal("Game", { rooms: {} });
    const memory: RoomMemory = { doctrine: "colonize", claimTarget: "W57N24" };

    const result = checkColonizeDoctrineComplete("W57N25", memory);

    expect(result).toBeNull();
    expect(memory.doctrine).toBe("colonize");
  });

  it("does nothing while the claim target is visible but has no spawn yet", () => {
    vi.stubGlobal("Game", { rooms: { W57N24: mockRoom("W57N24", 0) } });
    const memory: RoomMemory = { doctrine: "colonize", claimTarget: "W57N24" };

    const result = checkColonizeDoctrineComplete("W57N25", memory);

    expect(result).toBeNull();
    expect(memory.doctrine).toBe("colonize");
  });

  it("reverts to econ and reports the event once the claim target's spawn exists", () => {
    vi.stubGlobal("Game", { rooms: { W57N24: mockRoom("W57N24", 1) } });
    const memory: RoomMemory = { doctrine: "colonize", claimTarget: "W57N24" };

    const result = checkColonizeDoctrineComplete("W57N25", memory);

    expect(result).toEqual({ room: "W57N25", claimTarget: "W57N24" });
    expect(memory.doctrine).toBe("econ");
  });
});
