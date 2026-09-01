import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideNextSpawn, runSpawning, RoomState } from "../../src/spawn/spawnManager";
import { resetRoomCache } from "../../src/utils/roomCache";
import * as logger from "../../src/logging/logger";

vi.mock("../../src/logging/logger", () => ({ log: vi.fn() }));

function baseState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    creepCounts: { harvester: 0, upgrader: 0, builder: 0, hauler: 0, miner: 0 },
    sourcesWithoutContainerCount: 1,
    sourcesNeedingMiner: [],
    constructionSiteCount: 0,
    containerCount: 0,
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    ...overrides
  };
}

describe("decideNextSpawn", () => {
  it("spawns a harvester first when under the per-source target", () => {
    const decision = decideNextSpawn(baseState());

    expect(decision?.role).toBe("harvester");
    expect(decision?.body.length).toBeGreaterThan(0);
  });

  it("moves on to upgraders once harvester target is met and there are no containers", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 0, builder: 0, hauler: 0, miner: 0 }
    });

    expect(decideNextSpawn(state)?.role).toBe("upgrader");
  });

  it("wants a hauler once containers exist and the harvester target is met", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 0, builder: 0, hauler: 0, miner: 0 },
      containerCount: 1
    });

    expect(decideNextSpawn(state)?.role).toBe("hauler");
  });

  it("moves on to upgraders once both harvester and hauler targets are met", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 0, builder: 0, hauler: 1, miner: 0 },
      containerCount: 1
    });

    expect(decideNextSpawn(state)?.role).toBe("upgrader");
  });

  it("only wants builders when there are construction sites", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 0, hauler: 0, miner: 0 },
      constructionSiteCount: 0
    });
    expect(decideNextSpawn(state)).toBeNull();

    const withSites = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 0, hauler: 0, miner: 0 },
      constructionSiteCount: 3
    });
    expect(decideNextSpawn(withSites)?.role).toBe("builder");
  });

  it("returns null once every target is met", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 0, hauler: 0, miner: 0 }
    });

    expect(decideNextSpawn(state)).toBeNull();
  });

  it("skips an unaffordable priority role in favor of a cheaper one that's still under target", () => {
    // harvester block costs 300, upgrader block costs 200
    const state = baseState({
      creepCounts: { harvester: 0, upgrader: 0, builder: 0, hauler: 0, miner: 0 },
      energyAvailable: 200
    });

    expect(decideNextSpawn(state)?.role).toBe("upgrader");
  });

  it("returns null when nothing under target is affordable", () => {
    const state = baseState({ energyAvailable: 50 });

    expect(decideNextSpawn(state)).toBeNull();
  });

  it("skips a role for this tick rather than downsizing its body to fit leftover energy", () => {
    // Capacity supports a full 2-block (600 energy) harvester and a 4-block (800
    // energy) upgrader, but only 300 energy is on hand right now. Sizing off
    // available energy (the old, buggy behavior) would spawn a runt 1-block
    // harvester (300 energy) that's stuck that size forever. The fix should
    // instead wait: neither role's ideal, capacity-sized body is affordable yet.
    const state = baseState({
      creepCounts: { harvester: 0, upgrader: 0, builder: 0, hauler: 0, miner: 0 },
      energyAvailable: 300,
      energyCapacityAvailable: 800
    });

    expect(decideNextSpawn(state)).toBeNull();
  });
});

describe("runSpawning", () => {
  beforeEach(() => {
    resetRoomCache();
    vi.stubGlobal("Game", { creeps: {}, time: 12345 });
    vi.mocked(logger.log).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sourcePos = { x: 10, y: 10 };

  function mockRoom(
    opts: { containers?: number; containerAtSource?: boolean; energyAvailable?: number } = {}
  ) {
    // Containers default far from the source so pre-existing tests (which only care
    // about containerCount, not source adjacency) don't accidentally trigger a miner
    // slot. Pass containerAtSource to test the miner-assignment path specifically.
    const containers = Array.from({ length: opts.containers ?? 0 }, (_, i) => ({
      id: `container${i}`,
      structureType: STRUCTURE_CONTAINER,
      pos: opts.containerAtSource && i === 0 ? sourcePos : { x: 40, y: 40 }
    }));

    return {
      name: "W1N1",
      energyAvailable: opts.energyAvailable ?? 300,
      energyCapacityAvailable: 300,
      find: vi.fn((type: FindConstant) => {
        if (type === FIND_SOURCES_ACTIVE) return [{ id: "source1", pos: sourcePos }];
        if (type === FIND_CONSTRUCTION_SITES) return [];
        if (type === FIND_STRUCTURES) return containers;
        return [];
      })
    } as unknown as Room;
  }

  function mockSpawn(spawning = false, pos: { x: number; y: number } = { x: 0, y: 0 }) {
    return {
      spawning,
      pos,
      spawnCreep: vi.fn().mockReturnValue(OK),
      recycleCreep: vi.fn()
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
    expect(logger.log).toHaveBeenCalledWith("spawn", {
      role: "harvester",
      name: "harvester_12345"
    });
  });

  it("logs a spawn_failed event with the failure reason when spawnCreep fails", () => {
    const spawn = mockSpawn(false);
    (spawn.spawnCreep as ReturnType<typeof vi.fn>).mockReturnValue(ERR_NOT_ENOUGH_ENERGY);

    runSpawning(spawn, mockRoom());

    expect(logger.log).toHaveBeenCalledWith("spawn_failed", {
      role: "harvester",
      result: ERR_NOT_ENOUGH_ENERGY
    });
    expect(logger.log).not.toHaveBeenCalledWith("spawn", expect.anything());
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

  it("spawns a hauler once the harvester target is met and a container exists", () => {
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        h1: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } },
        h2: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } }
      }
    });
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom({ containers: 1 }));

    expect(spawn.spawnCreep).toHaveBeenCalledWith(expect.any(Array), "hauler_12345", {
      memory: { role: "hauler", working: false }
    });
  });

  it("spawns a miner assigned to the source once its container is built", () => {
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom({ containers: 1, containerAtSource: true }));

    expect(spawn.spawnCreep).toHaveBeenCalledWith(expect.arrayContaining([WORK]), "miner_12345", {
      memory: { role: "miner", working: false, sourceId: "source1" }
    });
  });

  it("does not spawn a second miner for a source that already has one assigned", () => {
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        m1: {
          room: { name: "W1N1" },
          memory: { role: "miner", working: false, sourceId: "source1" }
        }
      }
    });
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom({ containers: 1, containerAtSource: true }));

    expect(spawn.spawnCreep).not.toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringMatching(/^miner_/),
      expect.anything()
    );
  });

  it("recycles surplus harvesters, oldest (lowest ticksToLive) first, once their source has a miner covering it", () => {
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        h1: {
          room: { name: "W1N1" },
          memory: { role: "harvester", working: false },
          pos: { x: 0, y: 0 },
          ticksToLive: 1000
        },
        h2: {
          room: { name: "W1N1" },
          memory: { role: "harvester", working: false },
          pos: { x: 0, y: 0 },
          ticksToLive: 500
        }
      }
    });
    const spawn = mockSpawn(false, { x: 0, y: 0 });

    runSpawning(spawn, mockRoom({ containers: 1, containerAtSource: true }));

    expect(spawn.recycleCreep).toHaveBeenCalledTimes(2);
    expect(spawn.recycleCreep).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ticksToLive: 500 })
    );
    expect(spawn.recycleCreep).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ticksToLive: 1000 })
    );
  });

  it("does not recycle a surplus harvester that's too far from the spawn this tick", () => {
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        h1: {
          room: { name: "W1N1" },
          memory: { role: "harvester", working: false },
          pos: { x: 40, y: 40 },
          ticksToLive: 1000
        }
      }
    });
    const spawn = mockSpawn(false, { x: 0, y: 0 });

    runSpawning(spawn, mockRoom({ containers: 1, containerAtSource: true }));

    expect(spawn.recycleCreep).not.toHaveBeenCalled();
  });

  it("does not recycle harvesters when the count is at or below target", () => {
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        h1: {
          room: { name: "W1N1" },
          memory: { role: "harvester", working: false },
          pos: { x: 0, y: 0 },
          ticksToLive: 1000
        },
        h2: {
          room: { name: "W1N1" },
          memory: { role: "harvester", working: false },
          pos: { x: 0, y: 0 },
          ticksToLive: 500
        }
      }
    });
    const spawn = mockSpawn(false, { x: 0, y: 0 });

    runSpawning(spawn, mockRoom());

    expect(spawn.recycleCreep).not.toHaveBeenCalled();
  });
});
