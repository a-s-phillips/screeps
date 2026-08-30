import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideNextSpawn, runSpawning, RoomState } from "../../src/spawn/spawnManager";
import { resetRoomCache } from "../../src/utils/roomCache";

function baseState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    creepCounts: { harvester: 0, upgrader: 0, builder: 0 },
    activeSourceCount: 1,
    constructionSiteCount: 0,
    energyAvailable: 300,
    ...overrides
  };
}

describe("decideNextSpawn", () => {
  it("spawns a harvester first when under the per-source target", () => {
    const decision = decideNextSpawn(baseState());

    expect(decision?.role).toBe("harvester");
    expect(decision?.body.length).toBeGreaterThan(0);
  });

  it("moves on to upgraders once harvester target is met", () => {
    const state = baseState({ creepCounts: { harvester: 2, upgrader: 0, builder: 0 } });

    expect(decideNextSpawn(state)?.role).toBe("upgrader");
  });

  it("only wants builders when there are construction sites", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 0 },
      constructionSiteCount: 0
    });
    expect(decideNextSpawn(state)).toBeNull();

    const withSites = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 0 },
      constructionSiteCount: 3
    });
    expect(decideNextSpawn(withSites)?.role).toBe("builder");
  });

  it("returns null once every target is met", () => {
    const state = baseState({ creepCounts: { harvester: 2, upgrader: 2, builder: 0 } });

    expect(decideNextSpawn(state)).toBeNull();
  });

  it("skips an unaffordable priority role in favor of a cheaper one that's still under target", () => {
    // harvester block costs 300, upgrader block costs 200
    const state = baseState({
      creepCounts: { harvester: 0, upgrader: 0, builder: 0 },
      energyAvailable: 200
    });

    expect(decideNextSpawn(state)?.role).toBe("upgrader");
  });

  it("returns null when nothing under target is affordable", () => {
    const state = baseState({ energyAvailable: 50 });

    expect(decideNextSpawn(state)).toBeNull();
  });
});

describe("runSpawning", () => {
  beforeEach(() => {
    resetRoomCache();
    vi.stubGlobal("Game", { creeps: {}, time: 12345 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockRoom() {
    return {
      name: "W1N1",
      energyAvailable: 300,
      find: vi.fn((type: FindConstant) => {
        if (type === FIND_SOURCES_ACTIVE) return [{ id: "source1" }];
        if (type === FIND_CONSTRUCTION_SITES) return [];
        return [];
      })
    } as unknown as Room;
  }

  function mockSpawn(spawning = false) {
    return {
      spawning,
      spawnCreep: vi.fn().mockReturnValue(OK)
    } as unknown as StructureSpawn;
  }

  it("does nothing when the spawn is already spawning", () => {
    const spawn = mockSpawn(true);

    runSpawning(spawn, mockRoom());

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });

  it("spawns the next-needed role with a generated name and initial memory", () => {
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom());

    expect(spawn.spawnCreep).toHaveBeenCalledWith(
      expect.arrayContaining([WORK]),
      "harvester_12345",
      { memory: { role: "harvester", working: false } }
    );
  });

  it("counts existing creeps in the room toward their role targets", () => {
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        h1: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } },
        h2: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } }
      }
    });
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom());

    expect(spawn.spawnCreep).toHaveBeenCalledWith(expect.any(Array), "upgrader_12345", {
      memory: { role: "upgrader", working: false }
    });
  });

  it("does not spawn when no role is under target", () => {
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        h1: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } },
        h2: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } },
        u1: { room: { name: "W1N1" }, memory: { role: "upgrader", working: false } },
        u2: { room: { name: "W1N1" }, memory: { role: "upgrader", working: false } }
      }
    });
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom());

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });
});
