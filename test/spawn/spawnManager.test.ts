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
    // RCL1, matching upgraderTargetFor's min(controllerLevel + 1, cap) - keeps every
    // pre-existing test's implicit "upgrader target is 2" assumption intact.
    controllerLevel: 1,
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

  it("raises the upgrader target as controller level rises", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 0, hauler: 0, miner: 0 },
      controllerLevel: 3 // target = min(3 + 1, 4) = 4, so 2 upgraders is still under target
    });

    expect(decideNextSpawn(state)?.role).toBe("upgrader");
  });

  it("caps the upgrader target once it's met, even at a high controller level", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 4, builder: 0, hauler: 0, miner: 0 },
      controllerLevel: 6 // target = min(6 + 1, 4) = 4 (capped)
    });

    expect(decideNextSpawn(state)).toBeNull();
  });

  it("drops the upgrader target to 1 at controller level 8, where upgrade power itself is capped", () => {
    const state = baseState({
      creepCounts: { harvester: 2, upgrader: 1, builder: 0, hauler: 0, miner: 0 },
      controllerLevel: 8
    });

    expect(decideNextSpawn(state)).toBeNull();
  });

  it("scales the builder target with construction site count, capped", () => {
    const met = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 1, hauler: 0, miner: 0 },
      constructionSiteCount: 1
    });
    expect(decideNextSpawn(met)).toBeNull();

    const underTarget = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 1, hauler: 0, miner: 0 },
      constructionSiteCount: 5 // target = min(5, 3) = 3, so 1 builder is still under target
    });
    expect(decideNextSpawn(underTarget)?.role).toBe("builder");

    const atCap = baseState({
      creepCounts: { harvester: 2, upgrader: 2, builder: 3, hauler: 0, miner: 0 },
      constructionSiteCount: 5 // target capped at 3, already met
    });
    expect(decideNextSpawn(atCap)).toBeNull();
  });

  it("skips a role for this tick rather than downsizing its body, once a harvester already feeds the spawn", () => {
    // Capacity supports a full 2-block (600 energy) harvester and a 4-block (800
    // energy) upgrader, but only 300 energy is on hand right now. Sizing off
    // available energy (the old, buggy behavior) would spawn a runt 1-block
    // harvester (300 energy) that's stuck that size forever. With a harvester
    // already delivering energy to the spawn, the room isn't stuck - it's fine to
    // wait for the ideal, capacity-sized body to become affordable instead of
    // shrinking.
    const state = baseState({
      creepCounts: { harvester: 1, upgrader: 0, builder: 0, hauler: 0, miner: 0 },
      energyAvailable: 300,
      energyCapacityAvailable: 800
    });

    expect(decideNextSpawn(state)).toBeNull();
  });

  it("skips a role for this tick rather than downsizing its body, once a hauler already feeds the spawn", () => {
    // Same idea, but the spawn-feeder is a hauler instead of a harvester - either
    // one means the room isn't stuck, so no need to shrink.
    const state = baseState({
      creepCounts: { harvester: 0, upgrader: 0, builder: 0, hauler: 1, miner: 0 },
      sourcesWithoutContainerCount: 0,
      containerCount: 2,
      energyAvailable: 300,
      energyCapacityAvailable: 1300
    });

    expect(decideNextSpawn(state)).toBeNull();
  });

  it("sizes the harvester body down to fit available energy when nothing feeds the spawn yet", () => {
    // Same capacity/available split as the harvester "already feeds the spawn" test
    // above, but with zero harvesters and zero haulers, nothing can ever get energy
    // into the spawn - energyAvailable can only shrink from here, so waiting for the
    // full-capacity body would deadlock the room forever. Shrinking just this once,
    // to get any spawn-feeding creep out, is the fix.
    const state = baseState({
      creepCounts: { harvester: 0, upgrader: 0, builder: 0, hauler: 0, miner: 0 },
      energyAvailable: 300,
      energyCapacityAvailable: 800
    });

    const decision = decideNextSpawn(state);

    expect(decision?.role).toBe("harvester");
    expect(decision?.body).toEqual([WORK, WORK, CARRY, MOVE]);
  });

  it("sizes the miner body down to fit available energy when nothing feeds the spawn yet", () => {
    const state = baseState({
      sourcesNeedingMiner: ["source1" as Id<Source>],
      creepCounts: { harvester: 0, upgrader: 0, builder: 0, hauler: 0, miner: 0 },
      energyAvailable: 250,
      energyCapacityAvailable: 1300
    });

    const decision = decideNextSpawn(state);

    expect(decision?.role).toBe("miner");
    expect(decision?.memory).toEqual({ sourceId: "source1" });
    expect(decision?.body).toEqual([WORK, WORK, MOVE]);
  });

  it("still sizes a second miner down when only a miner (no harvester/hauler) exists, since a lone miner can't feed the spawn", () => {
    // This is the real bug found live: a miner only deposits into its own
    // container - nothing carries that to the spawn without a harvester or
    // hauler. So a miner alone must NOT count as "unstuck"; a second miner still
    // needs the same bootstrap treatment.
    const state = baseState({
      sourcesNeedingMiner: ["source2" as Id<Source>],
      creepCounts: { harvester: 0, upgrader: 0, builder: 0, hauler: 0, miner: 1 },
      energyAvailable: 300,
      energyCapacityAvailable: 1300
    });

    const decision = decideNextSpawn(state);

    expect(decision?.role).toBe("miner");
    expect(decision?.memory).toEqual({ sourceId: "source2" });
    expect(decision?.body).toEqual([WORK, WORK, MOVE]);
  });

  it("sizes the hauler body down to fit available energy when nothing feeds the spawn yet", () => {
    // The other half of the live bug: a lone bootstrap miner filled its container,
    // but the hauler needed to move that energy to the spawn was still sizing off
    // full capacity and could never afford to spawn.
    const state = baseState({
      sourcesWithoutContainerCount: 0,
      sourcesNeedingMiner: [],
      containerCount: 1,
      creepCounts: { harvester: 0, upgrader: 0, builder: 0, hauler: 0, miner: 1 },
      energyAvailable: 150,
      energyCapacityAvailable: 1300
    });

    const decision = decideNextSpawn(state);

    expect(decision?.role).toBe("hauler");
    expect(decision?.body).toEqual([CARRY, MOVE]);
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
  const controllerPos = { x: 25, y: 25 };

  function mockRoom(
    opts: {
      containers?: number;
      containerAtSource?: boolean;
      energyAvailable?: number;
      controllerLevel?: number;
    } = {}
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
      controller: { level: opts.controllerLevel ?? 1, pos: controllerPos },
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

  it("pre-spawns a replacement miner, for the same source, once the assigned miner is nearing death", () => {
    // energyCapacityAvailable 300 -> planMinerBody gives [WORK, WORK, MOVE] (length 3).
    // Spawn sits at (0,0), the source's container at (10,10) (containerAtSource),
    // chebyshev distance 10 -> lead time = 3 * CREEP_SPAWN_TIME + 10 = 19. A ticksToLive
    // of 15 is under that, so the source should read as needing a miner again even
    // though one is technically still assigned.
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        m1: {
          room: { name: "W1N1" },
          memory: { role: "miner", working: false, sourceId: "source1" },
          ticksToLive: 15
        }
      }
    });
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom({ containers: 1, containerAtSource: true }));

    expect(spawn.spawnCreep).toHaveBeenCalledWith(expect.arrayContaining([WORK]), "miner_12345", {
      memory: { role: "miner", working: false, sourceId: "source1" }
    });
  });

  it("does not pre-spawn a replacement miner while the assigned miner still has plenty of ticksToLive", () => {
    // Same setup as above (lead time 19), but ticksToLive 25 is comfortably above it.
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        m1: {
          room: { name: "W1N1" },
          memory: { role: "miner", working: false, sourceId: "source1" },
          ticksToLive: 25
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

  it("wires the room's actual controller level into the upgrader target", () => {
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

    // At the default controllerLevel (1) the upgrader target is already met (2/2) and
    // nothing spawns - see "does not spawn when no role is under target" above. A room
    // that's actually reached RCL3 should raise that target to 4 and want a 3rd upgrader.
    runSpawning(spawn, mockRoom({ controllerLevel: 3 }));

    expect(spawn.spawnCreep).toHaveBeenCalledWith(expect.any(Array), "upgrader_12345", {
      memory: { role: "upgrader", working: false }
    });
  });

  it("pre-spawns a replacement upgrader once one is nearing death", () => {
    // energyCapacityAvailable 300 -> planBody("upgrader", 300) gives [WORK, CARRY, MOVE]
    // (length 3). Spawn at (0,0), controller at (25,25) (chebyshev 25) -> lead time =
    // 3 * CREEP_SPAWN_TIME + 25 = 34. A ticksToLive of 20 is under that, so the dying
    // upgrader shouldn't count toward the RCL1 target of 2 - leaving room for a 3rd.
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        h1: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } },
        h2: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } },
        u1: {
          room: { name: "W1N1" },
          memory: { role: "upgrader", working: false },
          ticksToLive: 20
        },
        u2: { room: { name: "W1N1" }, memory: { role: "upgrader", working: false } }
      }
    });
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom());

    expect(spawn.spawnCreep).toHaveBeenCalledWith(expect.any(Array), "upgrader_12345", {
      memory: { role: "upgrader", working: false }
    });
  });

  it("does not pre-spawn an upgrader replacement while ticksToLive is comfortably above the lead time", () => {
    // Same setup (lead time 34), but ticksToLive 100 is well above it.
    vi.stubGlobal("Game", {
      time: 12345,
      creeps: {
        h1: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } },
        h2: { room: { name: "W1N1" }, memory: { role: "harvester", working: false } },
        u1: {
          room: { name: "W1N1" },
          memory: { role: "upgrader", working: false },
          ticksToLive: 100
        },
        u2: { room: { name: "W1N1" }, memory: { role: "upgrader", working: false } }
      }
    });
    const spawn = mockSpawn(false);

    runSpawning(spawn, mockRoom());

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
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
