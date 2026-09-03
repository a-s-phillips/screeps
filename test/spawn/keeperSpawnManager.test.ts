import { afterEach, describe, expect, it, vi } from "vitest";
import { decideKeeperSpawn } from "../../src/spawn/keeperSpawnManager";

function mockRoom(name: string, energy = 1000) {
  return { name, energyAvailable: energy, energyCapacityAvailable: energy } as unknown as Room;
}

describe("decideKeeperSpawn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when no keeperRoom is set", () => {
    vi.stubGlobal("Memory", { rooms: {} });
    vi.stubGlobal("Game", { creeps: {} });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision).toBeNull();
  });

  // No keeperIntel recorded yet - the room has never been scouted, so this doubles as
  // the bootstrap case (see isKeeperWindowReachable): one spawn is let through blind to
  // go establish vision, same as the original manual deploy accepted as a one-time sunk
  // cost.
  it("spawns a keeperHarvester when under target and the room has never been scouted", () => {
    vi.stubGlobal("Memory", { rooms: { W9N8: { keeperRoom: "W8N7" } } });
    vi.stubGlobal("Game", { creeps: {}, time: 0 });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("keeperHarvester");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N7" });
    expect(decision?.body.length).toBeGreaterThan(0);
  });

  it("returns null once the (raised, burst-friendly) target is met", () => {
    vi.stubGlobal("Memory", { rooms: { W9N8: { keeperRoom: "W8N7" } } });
    vi.stubGlobal("Game", {
      creeps: {
        k1: { memory: { role: "keeperHarvester", remoteRoom: "W8N7" } },
        k2: { memory: { role: "keeperHarvester", remoteRoom: "W8N7" } },
        k3: { memory: { role: "keeperHarvester", remoteRoom: "W8N7" } }
      }
    });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision).toBeNull();
  });

  it("spawns another keeperHarvester when still under the raised target", () => {
    vi.stubGlobal("Memory", { rooms: { W9N8: { keeperRoom: "W8N7" } } });
    vi.stubGlobal("Game", {
      creeps: {
        k1: { memory: { role: "keeperHarvester", remoteRoom: "W8N7" } },
        k2: { memory: { role: "keeperHarvester", remoteRoom: "W8N7" } }
      },
      time: 0
    });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("keeperHarvester");
  });

  it("does not count a keeperHarvester assigned to a different remote room toward the target", () => {
    vi.stubGlobal("Memory", { rooms: { W9N8: { keeperRoom: "W8N7" } } });
    vi.stubGlobal("Game", {
      creeps: {
        k1: { memory: { role: "keeperHarvester", remoteRoom: "SomeOtherRoom" } }
      }
    });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("keeperHarvester");
  });

  it("does not count a creep of a different role toward the target", () => {
    vi.stubGlobal("Memory", { rooms: { W9N8: { keeperRoom: "W8N7" } } });
    vi.stubGlobal("Game", {
      creeps: {
        r1: { memory: { role: "reserver", remoteRoom: "W8N7" } }
      }
    });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("keeperHarvester");
  });

  it("returns null when the body is unaffordable", () => {
    vi.stubGlobal("Memory", { rooms: { W9N8: { keeperRoom: "W8N7" } } });
    vi.stubGlobal("Game", { creeps: {} });

    const decision = decideKeeperSpawn(mockRoom("W9N8", 100));

    expect(decision).toBeNull();
  });

  // Found live: with no timing awareness at all, three keeperHarvesters in a row spawned
  // mid-guarded-phase and died of old age without ever harvesting a single tick of
  // energy, because nothing checked the lair timers before spawning (see project notes).
  it("does not spawn when the keeper room is known to be fully guarded", () => {
    vi.stubGlobal("Memory", {
      rooms: {
        W9N8: { keeperRoom: "W8N7" },
        W8N7: { keeperIntel: { nextWindowCloseTick: null, observedAt: 0 } }
      }
    });
    vi.stubGlobal("Game", { creeps: {}, time: 0 });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision).toBeNull();
  });

  it("does not spawn when the known window will already be closed by the time the creep could arrive", () => {
    vi.stubGlobal("Memory", {
      rooms: {
        W9N8: { keeperRoom: "W8N7" },
        W8N7: { keeperIntel: { nextWindowCloseTick: 1, observedAt: 0 } }
      }
    });
    vi.stubGlobal("Game", { creeps: {}, time: 0 });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision).toBeNull();
  });

  it("spawns when the known window comfortably covers spawn time plus travel", () => {
    vi.stubGlobal("Memory", {
      rooms: {
        W9N8: { keeperRoom: "W8N7" },
        W8N7: { keeperIntel: { nextWindowCloseTick: 100000, observedAt: 0 } }
      }
    });
    vi.stubGlobal("Game", { creeps: {}, time: 0 });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("keeperHarvester");
  });
});
