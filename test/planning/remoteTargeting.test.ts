import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRemoteCandidates,
  isRoomHostile,
  isRoomOwnedByOther,
  MAX_REMOTE_ROOMS,
  pickBestCandidate,
  recordRemoteIntel,
  REMOTE_HOSTILE_MEMORY_WINDOW,
  resolveNextRemoteRoom
} from "../../src/planning/remoteTargeting";

// A per-room exit map for tests that need genuinely different exits per room, rather
// than the single fixed mockReturnValue used by the rest of this file (which happens to
// make every tier-2 lookup collapse back to already-seen rooms, exercising none of the
// two-hop expansion).
function describeExitsFor(map: Record<string, Record<string, string>>) {
  return vi.fn((roomName: string) => map[roomName] ?? null);
}
import { resetRoomCache } from "../../src/utils/roomCache";

describe("getRemoteCandidates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the room names from Game.map.describeExits", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9", "3": "W8N8", "5": "W9N7" }) }
    });

    expect(getRemoteCandidates("W9N8")).toEqual(["W9N9", "W8N8", "W9N7"]);
  });

  it("returns an empty array when the room has no known exits", () => {
    vi.stubGlobal("Game", { map: { describeExits: vi.fn().mockReturnValue(null) } });

    expect(getRemoteCandidates("W9N8")).toEqual([]);
  });

  it("includes second-order neighbors, one hop past each direct exit", () => {
    // Reproduces the live gap: a home room whose direct exits are all already spoken
    // for (staffed, owned, reserved, or a keeper room) has nothing left to pick from
    // among tier 1 alone - the picker needs to see one hop further to have any legal
    // candidate at all.
    vi.stubGlobal("Game", {
      map: {
        describeExits: describeExitsFor({
          W9N8: { "1": "W9N9", "3": "W8N8" },
          W9N9: { "1": "W9N10" },
          W8N8: { "3": "W7N8" }
        })
      }
    });

    expect(getRemoteCandidates("W9N8")).toEqual(["W9N9", "W8N8", "W9N10", "W7N8"]);
  });

  it("deduplicates second-order rooms that are also a direct exit or the home room itself", () => {
    vi.stubGlobal("Game", {
      map: {
        describeExits: describeExitsFor({
          W9N8: { "1": "W9N9", "3": "W8N8" },
          // W9N9 borders the home room and the other direct exit - neither should be
          // reintroduced as a "new" second-order candidate.
          W9N9: { "1": "W9N8", "3": "W8N8", "5": "W9N10" },
          W8N8: { "1": "W9N9" }
        })
      }
    });

    expect(getRemoteCandidates("W9N8")).toEqual(["W9N9", "W8N8", "W9N10"]);
  });

  it("skips a tier-1 room's exits when it's already confirmed keeper-guarded", () => {
    // Reproduces the live bug: W55N25's only route from home runs through W56N25's
    // keeper lairs, so once that's known, W55N25 must not be offered as a tier-2
    // candidate through this gateway.
    vi.stubGlobal("Game", {
      map: {
        describeExits: describeExitsFor({
          W9N8: { "1": "W9N9", "3": "W8N8" },
          W9N9: { "1": "W9N10" }
        })
      }
    });
    vi.stubGlobal("Memory", {
      rooms: { W9N9: { remoteIntel: intel({ hasSourceKeeper: true }) } }
    });

    expect(getRemoteCandidates("W9N8")).toEqual(["W9N9", "W8N8"]);
  });

  it("still offers a tier-2 room reachable via a non-keeper gateway even if another gateway is guarded", () => {
    vi.stubGlobal("Game", {
      map: {
        describeExits: describeExitsFor({
          W9N8: { "1": "W9N9", "3": "W8N8" },
          W9N9: { "1": "W9N10" },
          W8N8: { "1": "W9N10" }
        })
      }
    });
    vi.stubGlobal("Memory", {
      rooms: { W9N9: { remoteIntel: intel({ hasSourceKeeper: true }) } }
    });

    expect(getRemoteCandidates("W9N8")).toEqual(["W9N9", "W8N8", "W9N10"]);
  });

  it("still offers a tier-1 room's exits while it remains unscouted, accepting the discovery cost", () => {
    vi.stubGlobal("Game", {
      map: {
        describeExits: describeExitsFor({
          W9N8: { "1": "W9N9" },
          W9N9: { "1": "W9N10" }
        })
      }
    });
    vi.stubGlobal("Memory", { rooms: {} });

    expect(getRemoteCandidates("W9N8")).toEqual(["W9N9", "W9N10"]);
  });
});

function intel(overrides: Partial<RemoteIntel> = {}): RemoteIntel {
  return {
    sourceCount: 2,
    ownedByOther: false,
    reservedByOther: false,
    hasSourceKeeper: false,
    ...overrides
  };
}

describe("pickBestCandidate", () => {
  it("returns undefined when any candidate still lacks intel", () => {
    const result = pickBestCandidate(["A", "B"], { A: intel() });

    expect(result).toBeUndefined();
  });

  it("picks the candidate with the most sources", () => {
    const result = pickBestCandidate(["A", "B"], {
      A: intel({ sourceCount: 1 }),
      B: intel({ sourceCount: 2 })
    });

    expect(result).toBe("B");
  });

  it("excludes a candidate owned by another player", () => {
    const result = pickBestCandidate(["A", "B"], {
      A: intel({ ownedByOther: true, sourceCount: 2 }),
      B: intel({ sourceCount: 1 })
    });

    expect(result).toBe("B");
  });

  it("excludes a candidate reserved by another player", () => {
    const result = pickBestCandidate(["A", "B"], {
      A: intel({ reservedByOther: true, sourceCount: 2 }),
      B: intel({ sourceCount: 1 })
    });

    expect(result).toBe("B");
  });

  it("excludes a Source Keeper room", () => {
    const result = pickBestCandidate(["A", "B"], {
      A: intel({ hasSourceKeeper: true, sourceCount: 2 }),
      B: intel({ sourceCount: 1 })
    });

    expect(result).toBe("B");
  });

  it("excludes a candidate with zero sources", () => {
    const result = pickBestCandidate(["A", "B"], {
      A: intel({ sourceCount: 0 }),
      B: intel({ sourceCount: 1 })
    });

    expect(result).toBe("B");
  });

  it("returns undefined when every candidate is excluded", () => {
    const result = pickBestCandidate(["A"], { A: intel({ ownedByOther: true }) });

    expect(result).toBeUndefined();
  });

  it("breaks a tie in source count by candidate list order", () => {
    const result = pickBestCandidate(["A", "B"], {
      A: intel({ sourceCount: 2 }),
      B: intel({ sourceCount: 2 })
    });

    expect(result).toBe("A");
  });

  it("returns undefined for an empty candidate list", () => {
    expect(pickBestCandidate([], {})).toBeUndefined();
  });
});

describe("resolveNextRemoteRoom", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns undefined immediately once at the cap, without touching Game.map", () => {
    vi.stubGlobal("Game", { map: { describeExits: vi.fn() } });
    const homeMemory: RoomMemory = {
      remoteRooms: Array.from({ length: MAX_REMOTE_ROOMS }, (_, i) => `R${i}`)
    };

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {});

    expect(result).toBeUndefined();
    expect(Game.map.describeExits).not.toHaveBeenCalled();
  });

  it("picks and appends a second candidate once every remaining candidate has intel", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9", "3": "W8N8", "5": "W9N7" }) }
    });
    const homeMemory: RoomMemory = { remoteRooms: ["W8N8"] };

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel({ sourceCount: 2 }) },
      W9N7: { remoteIntel: intel({ sourceCount: 1 }) }
    });

    expect(result).toBe("W9N9");
    expect(homeMemory.remoteRooms).toEqual(["W8N8", "W9N9"]);
  });

  it("excludes an already-chosen room from the candidate pool even if it would still win on source count", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9", "3": "W8N8" }) }
    });
    const homeMemory: RoomMemory = { remoteRooms: ["W8N8"] };

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel({ sourceCount: 1 }) },
      W8N8: { remoteIntel: intel({ sourceCount: 99 }) }
    });

    expect(result).toBe("W9N9");
    expect(homeMemory.remoteRooms).toEqual(["W8N8", "W9N9"]);
  });

  it("returns undefined and does not mutate remoteRooms while a remaining candidate is still unscouted", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9", "3": "W8N8", "5": "W9N7" }) }
    });
    const homeMemory: RoomMemory = { remoteRooms: ["W8N8"] };

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel() }
    });

    expect(result).toBeUndefined();
    expect(homeMemory.remoteRooms).toEqual(["W8N8"]);
  });

  it("resolves the first-ever remote room into a fresh array, not [undefined, picked]", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9", "3": "W8N8" }) }
    });
    const homeMemory: RoomMemory = {};

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel({ ownedByOther: true }) },
      W8N8: { remoteIntel: intel({ sourceCount: 2 }) }
    });

    expect(result).toBe("W8N8");
    expect(homeMemory.remoteRooms).toEqual(["W8N8"]);
  });

  it("falls through to second-order candidates once every direct exit is known and non-viable", () => {
    vi.stubGlobal("Game", {
      map: {
        describeExits: describeExitsFor({
          W9N8: { "1": "W9N9", "3": "W8N8" },
          W9N9: { "1": "W9N10" },
          W8N8: {}
        })
      }
    });
    const homeMemory: RoomMemory = {};

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel({ ownedByOther: true }) },
      W8N8: { remoteIntel: intel({ hasSourceKeeper: true }) },
      W9N10: { remoteIntel: intel({ sourceCount: 1 }) }
    });

    expect(result).toBe("W9N10");
    expect(homeMemory.remoteRooms).toEqual(["W9N10"]);
  });

  it("does not skip ahead to second-order candidates while a direct exit is still unscouted, even if the scouted ones are all non-viable", () => {
    vi.stubGlobal("Game", {
      map: {
        describeExits: describeExitsFor({
          W9N8: { "1": "W9N9", "3": "W8N8" },
          W9N9: { "1": "W9N10" },
          W8N8: {}
        })
      }
    });
    const homeMemory: RoomMemory = {};

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel({ ownedByOther: true }) },
      // W8N8 (still a direct exit) has no recorded intel yet - a closer candidate might
      // still turn out viable, so this must not skip ahead to W9N10.
      W9N10: { remoteIntel: intel({ sourceCount: 1 }) }
    });

    expect(result).toBeUndefined();
    expect(homeMemory.remoteRooms).toBeUndefined();
  });

  it("does not resolve a tier-2 room whose only known gateway is keeper-guarded", () => {
    // End-to-end reproduction of the live bug: W8N8 is a confirmed keeper room and the
    // only other tier-1 exit is non-viable, so the picker would normally fall through
    // to tier 2 - but W8N8's only exit (W7N8) must never be offered there, even though
    // it would otherwise win easily on source count, since the only known route to it
    // crosses W8N8's keeper lairs.
    vi.stubGlobal("Game", {
      map: {
        describeExits: describeExitsFor({
          W9N8: { "1": "W9N9", "3": "W8N8" },
          W9N9: {},
          W8N8: { "1": "W7N8" }
        })
      }
    });
    vi.stubGlobal("Memory", { rooms: { W8N8: { remoteIntel: intel({ hasSourceKeeper: true }) } } });
    const homeMemory: RoomMemory = {};

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel({ ownedByOther: true }) },
      W8N8: { remoteIntel: intel({ hasSourceKeeper: true }) },
      W7N8: { remoteIntel: intel({ sourceCount: 99 }) }
    });

    expect(result).toBeUndefined();
    expect(homeMemory.remoteRooms).toBeUndefined();
  });

  it("still resolves one more when exactly one slot under MAX_REMOTE_ROOMS remains", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9" }) }
    });
    const homeMemory: RoomMemory = {
      remoteRooms: Array.from({ length: MAX_REMOTE_ROOMS - 1 }, (_, i) => `R${i}`)
    };

    const result = resolveNextRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel({ sourceCount: 1 }) }
    });

    expect(result).toBe("W9N9");
    expect(homeMemory.remoteRooms).toHaveLength(MAX_REMOTE_ROOMS);
  });
});

function mockRoom(opts: {
  name: string;
  sourceCount?: number;
  owner?: string;
  isMine?: boolean;
  reservedBy?: string;
  hasKeeperLair?: boolean;
}) {
  const sources = Array.from({ length: opts.sourceCount ?? 0 }, (_, i) => ({ id: `source${i}` }));
  const hostileStructures = opts.hasKeeperLair ? [{ structureType: STRUCTURE_KEEPER_LAIR }] : [];

  return {
    name: opts.name,
    controller:
      opts.owner || opts.reservedBy
        ? {
            my: opts.isMine ?? false,
            owner: opts.owner ? { username: opts.owner } : undefined,
            reservation: opts.reservedBy ? { username: opts.reservedBy } : undefined
          }
        : undefined,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES) return sources;
      if (type === FIND_HOSTILE_STRUCTURES) return hostileStructures;
      return [];
    })
  } as unknown as Room;
}

describe("isRoomHostile", () => {
  it("is false when no hostile has ever been seen", () => {
    expect(isRoomHostile(undefined, 1000)).toBe(false);
  });

  it("is true right after a sighting", () => {
    expect(isRoomHostile(1000, 1000)).toBe(true);
  });

  it("is true exactly at the window boundary", () => {
    expect(isRoomHostile(1000, 1000 + REMOTE_HOSTILE_MEMORY_WINDOW)).toBe(true);
  });

  it("is false just past the window boundary", () => {
    expect(isRoomHostile(1000, 1000 + REMOTE_HOSTILE_MEMORY_WINDOW + 1)).toBe(false);
  });
});

describe("isRoomOwnedByOther", () => {
  it("is false when no intel has been recorded yet", () => {
    expect(isRoomOwnedByOther(undefined)).toBe(false);
  });

  it("is false when the room is not owned by another player", () => {
    expect(isRoomOwnedByOther(intel({ ownedByOther: false }))).toBe(false);
  });

  it("is true when the room is owned by another player", () => {
    expect(isRoomOwnedByOther(intel({ ownedByOther: true }))).toBe(true);
  });
});

describe("recordRemoteIntel", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the source count", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const room = mockRoom({ name: "W8N8", sourceCount: 2 });
    const memory: RoomMemory = {};

    recordRemoteIntel(room, memory);

    expect(memory.remoteIntel?.sourceCount).toBe(2);
  });

  it("flags a room owned by another player", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const room = mockRoom({ name: "W9N9", owner: "MichaelBot", isMine: false });
    const memory: RoomMemory = {};

    recordRemoteIntel(room, memory);

    expect(memory.remoteIntel?.ownedByOther).toBe(true);
  });

  it("does not flag our own owned room", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const room = mockRoom({ name: "W9N8", owner: "me", isMine: true });
    const memory: RoomMemory = {};

    recordRemoteIntel(room, memory);

    expect(memory.remoteIntel?.ownedByOther).toBe(false);
  });

  it("flags a room reserved by another player", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const room = mockRoom({ name: "W8N8", reservedBy: "someoneElse" });
    const memory: RoomMemory = {};

    recordRemoteIntel(room, memory);

    expect(memory.remoteIntel?.reservedByOther).toBe(true);
  });

  it("does not flag our own reservation", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const room = mockRoom({ name: "W8N8", reservedBy: "me" });
    const memory: RoomMemory = {};

    recordRemoteIntel(room, memory);

    expect(memory.remoteIntel?.reservedByOther).toBe(false);
  });

  it("flags a Source Keeper room via a keeper lair", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const room = mockRoom({ name: "W8N7", hasKeeperLair: true });
    const memory: RoomMemory = {};

    recordRemoteIntel(room, memory);

    expect(memory.remoteIntel?.hasSourceKeeper).toBe(true);
  });
});
