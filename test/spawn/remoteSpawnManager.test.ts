import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRemoteRoomState,
  decideNextRemoteSpawn,
  decideRemoteSpawn,
  decideScoutSpawn,
  RemoteRoomState
} from "../../src/spawn/remoteSpawnManager";
import { resetRoomCache } from "../../src/utils/roomCache";

// getCachedFind (used by buildRemoteRoomState) caches by room name across the whole
// file - several tests below reuse room names like "W8N8"/"W9N7" with different mock
// find() results, so a reset between tests is required, not optional.
beforeEach(() => {
  resetRoomCache();
});

describe("decideScoutSpawn", () => {
  it("spawns a scout for the first candidate with no recorded intel and no scout en route", () => {
    const decision = decideScoutSpawn("W9N8", ["W9N9", "W8N8"], {}, new Set());

    expect(decision?.role).toBe("scout");
    expect(decision?.body).toEqual([MOVE]);
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W9N9" });
  });

  it("skips a candidate that already has recorded intel", () => {
    const decision = decideScoutSpawn(
      "W9N8",
      ["W9N9", "W8N8"],
      {
        W9N9: {
          remoteIntel: {
            sourceCount: 1,
            ownedByOther: false,
            reservedByOther: false,
            hasSourceKeeper: false
          }
        }
      },
      new Set()
    );

    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N8" });
  });

  it("skips a candidate that already has a scout en route", () => {
    const decision = decideScoutSpawn("W9N8", ["W9N9", "W8N8"], {}, new Set(["W9N9"]));

    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N8" });
  });

  it("returns null once every candidate is either scouted or has a scout en route", () => {
    const decision = decideScoutSpawn(
      "W9N8",
      ["W9N9", "W8N8"],
      {
        W9N9: {
          remoteIntel: {
            sourceCount: 1,
            ownedByOther: false,
            reservedByOther: false,
            hasSourceKeeper: false
          }
        }
      },
      new Set(["W8N8"])
    );

    expect(decision).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(decideScoutSpawn("W9N8", [], {}, new Set())).toBeNull();
  });
});

function mockRoom(name: string, energy = 1000) {
  return { name, energyAvailable: energy, energyCapacityAvailable: energy } as unknown as Room;
}

describe("decideRemoteSpawn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("spawns a scout when no remote room has been resolved yet", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9" }) },
      creeps: {}
    });
    vi.stubGlobal("Memory", { rooms: {} });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("scout");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W9N9" });
  });

  it("spawns a reserver once a remote room is resolved but has none yet, without touching Game.map", () => {
    vi.stubGlobal("Game", { map: { describeExits: vi.fn() }, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("reserver");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N8" });
    expect(Game.map.describeExits).not.toHaveBeenCalled();
  });

  it("does not spawn a second scout for a candidate that already has one en route", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9" }) },
      creeps: {
        scout1: { memory: { role: "scout", remoteRoom: "W9N9" } }
      }
    });
    vi.stubGlobal("Memory", { rooms: {} });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision).toBeNull();
  });

  it("persists a newly-resolved remote room into remoteRooms once every candidate has intel", () => {
    const rooms: Record<string, RoomMemory> = {
      W9N9: {
        remoteIntel: {
          sourceCount: 2,
          ownedByOther: false,
          reservedByOther: false,
          hasSourceKeeper: false
        }
      }
    };
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9" }) },
      creeps: {},
      rooms: {}
    });
    vi.stubGlobal("Memory", { rooms });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("reserver");
    expect(rooms.W9N8.remoteRooms).toEqual(["W9N9"]);
  });

  it("seeks a second remote room once the first is fully staffed and the cap allows it", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W8N8", "3": "W9N7" }) },
      creeps: { r1: { memory: { role: "reserver", remoteRoom: "W8N8" } } },
      rooms: {}
    });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8"] } } });

    decideRemoteSpawn(mockRoom("W9N8"));

    expect(Game.map.describeExits).toHaveBeenCalled();
  });

  it("services room 2's unmet need once room 1 is fully staffed (strict-order fallthrough)", () => {
    const remoteRoom2 = mockVisibleRemoteRoom({
      name: "W9N7",
      sources: [{ id: "s2", pos: { x: 20, y: 20 } }],
      containers: [{ id: "c2", pos: { x: 21, y: 20 } }]
    });
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn() },
      creeps: {
        r1: { memory: { role: "reserver", remoteRoom: "W8N8" } },
        r2: { memory: { role: "reserver", remoteRoom: "W9N7" } },
        m2: { memory: { role: "miner", remoteRoom: "W9N7", sourceId: "s2" } }
      },
      rooms: { W9N7: remoteRoom2 }
    });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8", "W9N7"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("remoteHauler");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W9N7" });
  });

  it("services room 1 before room 2 when both have a routine unmet need (strict order)", () => {
    const remoteRoom1 = mockVisibleRemoteRoom({
      name: "W8N8",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      containers: [{ id: "c1", pos: { x: 11, y: 10 } }]
    });
    const remoteRoom2 = mockVisibleRemoteRoom({
      name: "W9N7",
      sources: [{ id: "s2", pos: { x: 20, y: 20 } }],
      containers: [{ id: "c2", pos: { x: 21, y: 20 } }]
    });
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn() },
      creeps: {
        r1: { memory: { role: "reserver", remoteRoom: "W8N8" } },
        m1: { memory: { role: "miner", remoteRoom: "W8N8", sourceId: "s1" } },
        r2: { memory: { role: "reserver", remoteRoom: "W9N7" } },
        m2: { memory: { role: "miner", remoteRoom: "W9N7", sourceId: "s2" } }
      },
      rooms: { W8N8: remoteRoom1, W9N7: remoteRoom2 }
    });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8", "W9N7"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("remoteHauler");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N8" });
  });

  it("pre-empts strict order for a from-scratch room 2 over room 1's routine restaff need", () => {
    const remoteRoom1 = mockVisibleRemoteRoom({
      name: "W8N8",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      containers: [{ id: "c1", pos: { x: 11, y: 10 } }]
    });
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn() },
      creeps: { r1: { memory: { role: "reserver", remoteRoom: "W8N8" } } },
      rooms: { W8N8: remoteRoom1 }
    });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8", "W9N7"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("reserver");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W9N7" });
  });

  it("returns null and never touches Game.map once at cap with every resolved room fully staffed", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn() },
      creeps: {
        r1: { memory: { role: "reserver", remoteRoom: "W8N8" } },
        r2: { memory: { role: "reserver", remoteRoom: "W9N7" } }
      },
      rooms: {}
    });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8", "W9N7"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision).toBeNull();
    expect(Game.map.describeExits).not.toHaveBeenCalled();
  });
});

function baseRemoteState(overrides: Partial<RemoteRoomState> = {}): RemoteRoomState {
  return {
    homeRoomName: "W9N8",
    remoteRoomName: "W8N8",
    hostileRecentlySeen: false,
    reserverCount: 0,
    remoteHarvesterCount: 0,
    remoteHaulerCount: 0,
    sourcesWithoutContainerCount: 0,
    sourcesNeedingMiner: [],
    remoteContainerCount: 0,
    energyAvailable: 1000,
    energyCapacityAvailable: 1000,
    ...overrides
  };
}

describe("decideNextRemoteSpawn", () => {
  it("spawns a reserver when there is none yet", () => {
    const decision = decideNextRemoteSpawn(baseRemoteState());

    expect(decision?.role).toBe("reserver");
    expect(decision?.body).toEqual([CLAIM, MOVE]);
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N8" });
  });

  it("spawns a miner for a source that has a container but no miner, ahead of harvester/hauler needs", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        sourcesNeedingMiner: ["source1" as Id<Source>],
        sourcesWithoutContainerCount: 1,
        remoteContainerCount: 1
      })
    );

    expect(decision?.role).toBe("miner");
    expect(decision?.memory).toEqual({
      sourceId: "source1",
      homeRoom: "W9N8",
      remoteRoom: "W8N8"
    });
  });

  it("spawns a remoteHarvester for an uncontained source once the reserver and miner needs are met", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({ reserverCount: 1, sourcesWithoutContainerCount: 1 })
    );

    expect(decision?.role).toBe("remoteHarvester");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N8" });
  });

  it("spawns a remoteHauler once a container exists and the hauler target isn't met", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({ reserverCount: 1, remoteContainerCount: 1 })
    );

    expect(decision?.role).toBe("remoteHauler");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N8" });
  });

  it("returns null once every target is met", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        remoteContainerCount: 1,
        remoteHaulerCount: 1
      })
    );

    expect(decision).toBeNull();
  });

  it("returns null when a hostile has been seen recently in the remote room, even with no reserver", () => {
    const decision = decideNextRemoteSpawn(baseRemoteState({ hostileRecentlySeen: true }));

    expect(decision).toBeNull();
  });

  it("returns null when the reserver body is unaffordable", () => {
    const decision = decideNextRemoteSpawn(baseRemoteState({ energyAvailable: 100 }));

    expect(decision).toBeNull();
  });

  it("falls through to the round-robin when the miner body is unaffordable", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        sourcesNeedingMiner: ["source1" as Id<Source>],
        energyAvailable: 100
      })
    );

    expect(decision).toBeNull();
  });
});

function mockVisibleRemoteRoom(opts: {
  name: string;
  sources?: { id: string; pos: { x: number; y: number } }[];
  containers?: { id: string; pos: { x: number; y: number } }[];
}) {
  const sources = opts.sources ?? [];
  const containers = (opts.containers ?? []).map((c) => ({
    ...c,
    structureType: STRUCTURE_CONTAINER
  }));

  return {
    name: opts.name,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES) return sources;
      if (type === FIND_STRUCTURES) return containers;
      return [];
    })
  };
}

describe("buildRemoteRoomState", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts reservers, remoteHarvesters, and remoteHaulers assigned to this specific remote room", () => {
    vi.stubGlobal("Game", {
      time: 1000,
      rooms: {},
      creeps: {
        r1: { memory: { role: "reserver", remoteRoom: "W8N8" } },
        rh1: { memory: { role: "remoteHarvester", remoteRoom: "W8N8" } },
        rh2: { memory: { role: "remoteHarvester", remoteRoom: "W9N7" } },
        rl1: { memory: { role: "remoteHauler", remoteRoom: "W8N8" } },
        s1: { memory: { role: "scout", remoteRoom: "W8N8" } }
      }
    });
    vi.stubGlobal("Memory", { rooms: {} });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.reserverCount).toBe(1);
    expect(state.remoteHarvesterCount).toBe(1);
    expect(state.remoteHaulerCount).toBe(1);
  });

  it("reports a recently-seen hostile within the remote-room recency window", () => {
    vi.stubGlobal("Game", { time: 1000, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", { rooms: { W8N8: { lastHostileSeenTick: 950 } } });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.hostileRecentlySeen).toBe(true);
  });

  it("does not report a hostile seen long ago as recent", () => {
    vi.stubGlobal("Game", { time: 5000, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", { rooms: { W8N8: { lastHostileSeenTick: 100 } } });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.hostileRecentlySeen).toBe(false);
  });

  it("computes sourcesWithoutContainerCount, sourcesNeedingMiner, and remoteContainerCount from live vision", () => {
    const remoteRoom = mockVisibleRemoteRoom({
      name: "W8N8",
      sources: [
        { id: "sourceWithContainer", pos: { x: 10, y: 10 } },
        { id: "sourceWithoutContainer", pos: { x: 30, y: 30 } }
      ],
      containers: [{ id: "container1", pos: { x: 11, y: 10 } }]
    });
    vi.stubGlobal("Game", { time: 1000, creeps: {}, rooms: { W8N8: remoteRoom } });
    vi.stubGlobal("Memory", { rooms: {} });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.sourcesWithoutContainerCount).toBe(1);
    expect(state.sourcesNeedingMiner).toEqual(["sourceWithContainer"]);
    expect(state.remoteContainerCount).toBe(1);
  });

  it("excludes a source from sourcesNeedingMiner once a miner is already assigned to it", () => {
    const remoteRoom = mockVisibleRemoteRoom({
      name: "W8N8",
      sources: [{ id: "sourceWithContainer", pos: { x: 10, y: 10 } }],
      containers: [{ id: "container1", pos: { x: 11, y: 10 } }]
    });
    vi.stubGlobal("Game", {
      time: 1000,
      rooms: { W8N8: remoteRoom },
      creeps: {
        m1: {
          memory: { role: "miner", remoteRoom: "W8N8", sourceId: "sourceWithContainer" }
        }
      }
    });
    vi.stubGlobal("Memory", { rooms: {} });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.sourcesNeedingMiner).toEqual([]);
  });

  it("defaults remote-room-derived fields to zero when the remote room isn't currently visible", () => {
    vi.stubGlobal("Game", { time: 1000, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", { rooms: {} });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.sourcesWithoutContainerCount).toBe(0);
    expect(state.sourcesNeedingMiner).toEqual([]);
    expect(state.remoteContainerCount).toBe(0);
  });
});
