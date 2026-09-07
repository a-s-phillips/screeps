import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRemoteRoomState,
  decideNextRemoteSpawn,
  decideRemoteSpawn,
  decideScoutSpawn,
  MAX_RESERVER_CLAIM_PARTS,
  remoteHaulerTarget,
  RemoteRoomState
} from "../../src/spawn/remoteSpawnManager";
import { resetRoomCache } from "../../src/utils/roomCache";

// getCachedFind (used by buildRemoteRoomState) caches by room name across the whole
// file - several tests below reuse room names like "W8N8"/"W9N7" with different mock
// find() results, so a reset between tests is required, not optional.
beforeEach(() => {
  resetRoomCache();
});

// buildRemoteRoomState now counts active CLAIM parts on our own Game.creeps reservers
// (not just headcount), so mock reservers need a real body - defaults to 1 CLAIM part,
// matching the fixed body every reserver had before that counting existed.
function reserverCreep(remoteRoom: string, claimParts = 1) {
  return {
    memory: { role: "reserver", remoteRoom },
    body: Array.from({ length: claimParts }, () => ({ type: CLAIM, hits: 100 }))
  };
}

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

  // Game.map.describeExits is now checked first (see the scout-priority comment below),
  // so this no longer skips it the way it used to when the bootstrap pre-empt ran first -
  // describeExits is free in Screeps, so that lost optimization isn't a correctness
  // concern, just a behavior this test used to (incidentally) lock in.
  it("spawns a reserver once a remote room is resolved but has none yet and no candidate needs scouting", () => {
    vi.stubGlobal("Game", { map: { describeExits: vi.fn() }, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("reserver");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W8N8" });
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
      creeps: { r1: reserverCreep("W8N8") },
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
        r1: reserverCreep("W8N8"),
        r2: reserverCreep("W9N7"),
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
        r1: reserverCreep("W8N8"),
        m1: { memory: { role: "miner", remoteRoom: "W8N8", sourceId: "s1" } },
        r2: reserverCreep("W9N7"),
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
      creeps: { r1: reserverCreep("W8N8") },
      rooms: { W8N8: remoteRoom1 }
    });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8", "W9N7"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("reserver");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W9N7" });
  });

  it("spawns a scout ahead of an already-resolved room's routine restaffing need", () => {
    // W8N8 has a reserver (so it isn't "unbootstrapped") but still has a routine unmet
    // need - a source without a container wants a remoteHarvester. W9N7 is a second
    // tier-1 exit with no recorded intel yet. An ongoing contest over W8N8 (a rival
    // out-reserving us, a repeatedly-destroyed container, etc.) can otherwise keep
    // producing a routine unmet need on every single tick, starving scouting of W9N7
    // indefinitely - the carve-out means the scout wins this tick regardless.
    const remoteRoom1 = mockVisibleRemoteRoom({
      name: "W8N8",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }]
    });
    vi.stubGlobal("Game", {
      map: {
        describeExits: vi.fn((roomName: string) =>
          roomName === "W9N8" ? { "1": "W8N8", "3": "W9N7" } : {}
        )
      },
      creeps: { r1: reserverCreep("W8N8") },
      rooms: { W8N8: remoteRoom1 }
    });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("scout");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W9N7" });
  });

  // Regression coverage for the live bug this fix closes: reserverCount === 0 also
  // happens to an *established* room whose reserver just died mid-contest, not only to a
  // genuinely fresh room - and the bootstrap pre-empt can't tell the two apart. Found
  // live: W57N24's sustained reservation fight against a rival kept its reserver count
  // dipping to 0 often enough that the bootstrap pre-empt claimed the spawn slot before
  // execution ever reached the round-robin fix from "Let scouting jump ahead of
  // contested-remote restaffing" (4826095) - W59N25 stayed unscouted for 20,000+ ticks
  // even after that fix shipped, because the contest never let it get that far.
  it("spawns a scout ahead of the bootstrap pre-empt when an established room's reserver just died", () => {
    vi.stubGlobal("Game", {
      map: {
        describeExits: vi.fn((roomName: string) =>
          roomName === "W9N8" ? { "1": "W8N8", "3": "W9N7" } : {}
        )
      },
      creeps: {},
      rooms: {}
    });
    vi.stubGlobal("Memory", { rooms: { W9N8: { remoteRooms: ["W8N8"] } } });

    const decision = decideRemoteSpawn(mockRoom("W9N8"));

    expect(decision?.role).toBe("scout");
    expect(decision?.memory).toEqual({ homeRoom: "W9N8", remoteRoom: "W9N7" });
  });

  it("returns null and never touches Game.map once at cap with every resolved room fully staffed", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn() },
      creeps: {
        r1: reserverCreep("W8N8"),
        r2: reserverCreep("W9N7")
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
    ownedByOther: false,
    reserverCount: 0,
    // Mirrors the old fixed 1-CLAIM reserver body: a test that only overrides
    // reserverCount (most of them, below) gets one CLAIM part per reserver for free,
    // same as before this field existed. Tests exercising a reservation contest override
    // ourReserverClaimParts/hostileReservationClaimParts explicitly instead.
    ourReserverClaimParts: overrides.ourReserverClaimParts ?? overrides.reserverCount ?? 0,
    hostileReservationClaimParts: 0,
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

describe("remoteHaulerTarget", () => {
  it("targets zero when no container has been built yet", () => {
    const target = remoteHaulerTarget(baseRemoteState({ remoteContainerCount: 0 }), 170);

    expect(target).toBe(0);
  });

  it("scales the target to the source's yield relative to a single hauler's round-trip throughput", () => {
    // energyCapacityAvailable 1700 -> 17x[CARRY,MOVE] -> 850 cargo. At a 170-tick round
    // trip that's exactly 5 energy/tick per hauler; one container's sustained yield
    // (SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME = 10 energy/tick) needs exactly 2.
    const target = remoteHaulerTarget(
      baseRemoteState({ remoteContainerCount: 1, energyCapacityAvailable: 1700 }),
      170
    );

    expect(target).toBe(2);
  });

  it("rounds up when the throughput ratio isn't a whole number", () => {
    // energyCapacityAvailable 1000 -> 10x[CARRY,MOVE] -> 500 cargo -> 500/170 ≈ 2.94
    // energy/tick per hauler; ceil(10 / 2.94) = 4, not 3 - a fraction of a hauler still
    // means the source's yield isn't fully captured, so it rounds up rather than down.
    const target = remoteHaulerTarget(
      baseRemoteState({ remoteContainerCount: 1, energyCapacityAvailable: 1000 }),
      170
    );

    expect(target).toBe(4);
  });

  it("scales desired throughput with multiple containers", () => {
    const target = remoteHaulerTarget(
      baseRemoteState({ remoteContainerCount: 2, energyCapacityAvailable: 1700 }),
      170
    );

    expect(target).toBe(4);
  });

  it("returns zero when the room can't afford even one remoteHauler body", () => {
    const target = remoteHaulerTarget(
      baseRemoteState({ remoteContainerCount: 1, energyCapacityAvailable: 50 }),
      170
    );

    expect(target).toBe(0);
  });

  it("defaults to the module's round-trip estimate when none is passed explicitly", () => {
    const target = remoteHaulerTarget(
      baseRemoteState({ remoteContainerCount: 1, energyCapacityAvailable: 1700 })
    );

    expect(target).toBeGreaterThan(0);
  });
});

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
    // energyCapacityAvailable 1700 -> remoteHaulerTarget's own test above works out to
    // exactly 2 for one container at the module's default round-trip estimate.
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        remoteContainerCount: 1,
        remoteHaulerCount: 2,
        energyCapacityAvailable: 1700
      })
    );

    expect(decision).toBeNull();
  });

  it("returns null when a hostile has been seen recently in the remote room, even with no reserver", () => {
    const decision = decideNextRemoteSpawn(baseRemoteState({ hostileRecentlySeen: true }));

    expect(decision).toBeNull();
  });

  it("returns null when the remote room is owned by another player, even with no reserver", () => {
    const decision = decideNextRemoteSpawn(baseRemoteState({ ownedByOther: true }));

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

  it("reinforces the reserver with enough CLAIM parts to overturn a rival's reservation", () => {
    // A rival fielding 2 CLAIM parts out-reserves our existing 1-CLAIM reserver forever
    // (both actions move the reservation timer by 1 tick per CLAIM part per tick) - the
    // fix needs 2 more CLAIM parts, not just a flat replacement, to net ahead at 3 vs 2.
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        ourReserverClaimParts: 1,
        hostileReservationClaimParts: 2,
        energyAvailable: 5000,
        energyCapacityAvailable: 5000
      })
    );

    expect(decision?.role).toBe("reserver");
    expect(decision?.body).toEqual([CLAIM, MOVE, CLAIM, MOVE]);
  });

  it("stops reinforcing once our CLAIM parts already outnumber the rival's", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        ourReserverClaimParts: 3,
        hostileReservationClaimParts: 2,
        sourcesWithoutContainerCount: 1
      })
    );

    expect(decision?.role).toBe("remoteHarvester");
  });

  it("returns null when a reservation-contest reinforcement is unaffordable and there's no other work", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        ourReserverClaimParts: 1,
        hostileReservationClaimParts: 2,
        energyAvailable: 100
      })
    );

    expect(decision).toBeNull();
  });

  // Regression coverage for the live bug this fix closes: W57N24's sustained
  // reservation contest kept ourReserverClaimParts perpetually behind
  // hostileReservationClaimParts + 1, and the old code hard-returned (reinforce, or
  // null) right there every time - never reaching miner/remoteHarvester/remoteHauler
  // below - even though a reserver was already present. Found live: 241 reserver
  // spawns over ~174k ticks against W57N24, while remoteHauler sat at zero population
  // 63% of that time.
  it("falls through to an economy role when the reinforcement is unaffordable but a reserver is already present", () => {
    // energyAvailable 300 covers a modest remoteHauler body but not the 1300-energy,
    // 2-more-CLAIM-part reinforcement this contest calls for.
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        ourReserverClaimParts: 1,
        hostileReservationClaimParts: 2,
        energyAvailable: 300,
        energyCapacityAvailable: 300,
        remoteContainerCount: 1
      })
    );

    expect(decision?.role).toBe("remoteHauler");
  });

  it("never builds a reserver past MAX_RESERVER_CLAIM_PARTS, no matter how far ahead the rival gets", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 0,
        ourReserverClaimParts: 0,
        hostileReservationClaimParts: 50,
        energyAvailable: 10000,
        energyCapacityAvailable: 10000
      })
    );

    expect(decision?.role).toBe("reserver");
    expect(decision?.body).toHaveLength(MAX_RESERVER_CLAIM_PARTS * 2);
  });

  it("stops escalating once already at the cap, even with an outmatching rival, and moves on to economy roles", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 1,
        ourReserverClaimParts: MAX_RESERVER_CLAIM_PARTS,
        hostileReservationClaimParts: 50,
        sourcesWithoutContainerCount: 1
      })
    );

    expect(decision?.role).toBe("remoteHarvester");
  });

  it("still hard-blocks when there is no reserver presence at all, even under the cap", () => {
    const decision = decideNextRemoteSpawn(
      baseRemoteState({
        reserverCount: 0,
        ourReserverClaimParts: 0,
        hostileReservationClaimParts: 0,
        energyAvailable: 100,
        remoteContainerCount: 1
      })
    );

    expect(decision).toBeNull();
  });
});

function mockVisibleRemoteRoom(opts: {
  name: string;
  sources?: { id: string; pos: { x: number; y: number } }[];
  containers?: { id: string; pos: { x: number; y: number } }[];
  hostileClaimParts?: number[];
}) {
  const sources = opts.sources ?? [];
  const containers = (opts.containers ?? []).map((c) => ({
    ...c,
    structureType: STRUCTURE_CONTAINER
  }));
  const hostiles = (opts.hostileClaimParts ?? []).map((claimParts) => ({
    body: Array.from({ length: claimParts }, () => ({ type: CLAIM, hits: 100 }))
  }));

  return {
    name: opts.name,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES) return sources;
      if (type === FIND_STRUCTURES) return containers;
      if (type === FIND_HOSTILE_CREEPS) return hostiles;
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
        r1: reserverCreep("W8N8"),
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

  it("sums active CLAIM parts across our own reservers assigned to this remote room", () => {
    vi.stubGlobal("Game", {
      time: 1000,
      rooms: {},
      creeps: {
        r1: reserverCreep("W8N8", 2),
        r2: reserverCreep("W8N8", 1),
        r3: reserverCreep("W9N7", 5)
      }
    });
    vi.stubGlobal("Memory", { rooms: {} });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.ourReserverClaimParts).toBe(3);
  });

  it("sums active CLAIM parts across hostile creeps currently visible in the remote room", () => {
    const remoteRoom = mockVisibleRemoteRoom({ name: "W8N8", hostileClaimParts: [2, 1] });
    vi.stubGlobal("Game", { time: 1000, creeps: {}, rooms: { W8N8: remoteRoom } });
    vi.stubGlobal("Memory", { rooms: {} });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.hostileReservationClaimParts).toBe(3);
  });

  it("defaults hostileReservationClaimParts to zero when the remote room isn't visible", () => {
    vi.stubGlobal("Game", { time: 1000, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", { rooms: {} });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.hostileReservationClaimParts).toBe(0);
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

  it("reports ownedByOther from recorded remote intel", () => {
    vi.stubGlobal("Game", { time: 1000, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", {
      rooms: {
        W8N8: {
          remoteIntel: {
            ownedByOther: true,
            sourceCount: 1,
            reservedByOther: false,
            hasSourceKeeper: false
          }
        }
      }
    });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.ownedByOther).toBe(true);
  });

  it("defaults ownedByOther to false when no intel has been recorded yet", () => {
    vi.stubGlobal("Game", { time: 1000, creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", { rooms: {} });

    const state = buildRemoteRoomState(mockRoom("W9N8"), "W8N8");

    expect(state.ownedByOther).toBe(false);
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
