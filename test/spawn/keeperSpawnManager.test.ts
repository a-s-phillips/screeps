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

  it("spawns a keeperHarvester when under target", () => {
    vi.stubGlobal("Memory", { rooms: { W9N8: { keeperRoom: "W8N7" } } });
    vi.stubGlobal("Game", { creeps: {} });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("keeperHarvester");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N7" });
    expect(decision?.body.length).toBeGreaterThan(0);
  });

  it("returns null once the target is met", () => {
    vi.stubGlobal("Memory", { rooms: { W9N8: { keeperRoom: "W8N7" } } });
    vi.stubGlobal("Game", {
      creeps: {
        k1: { memory: { role: "keeperHarvester", remoteRoom: "W8N7" } }
      }
    });

    const decision = decideKeeperSpawn(mockRoom("W9N8"));

    expect(decision).toBeNull();
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
});
