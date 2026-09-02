import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRemoteRoomState,
  decideNextRemoteSpawn,
  decideRemoteSpawn,
  decideScoutSpawn,
  RemoteRoomState
} from "../../src/spawn/remoteSpawnManager";

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

  it("spawns a reserver once a remote room is resolved but has none yet", () => {
    vi.stubGlobal("Game", { map: { describeExits: vi.fn() }, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRoom: "W8N8" } } });

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

  it("persists the resolved remote room into the home room's memory once every candidate has intel", () => {
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
    expect(rooms.W9N8.remoteRoom).toBe("W9N9");
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
