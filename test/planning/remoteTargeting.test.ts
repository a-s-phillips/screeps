import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRemoteCandidates,
  isRoomHostile,
  pickBestCandidate,
  recordRemoteIntel,
  REMOTE_HOSTILE_MEMORY_WINDOW,
  resolveRemoteRoom
} from "../../src/planning/remoteTargeting";
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

describe("resolveRemoteRoom", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the already-chosen remote room without re-evaluating candidates", () => {
    vi.stubGlobal("Game", { map: { describeExits: vi.fn() } });
    const homeMemory: RoomMemory = { remoteRoom: "W8N8" };

    const result = resolveRemoteRoom("W9N8", homeMemory, {});

    expect(result).toBe("W8N8");
    expect(Game.map.describeExits).not.toHaveBeenCalled();
  });

  it("picks and persists the best candidate once every candidate has intel", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9", "3": "W8N8" }) }
    });
    const homeMemory: RoomMemory = {};

    const result = resolveRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel({ ownedByOther: true }) },
      W8N8: { remoteIntel: intel({ sourceCount: 2 }) }
    });

    expect(result).toBe("W8N8");
    expect(homeMemory.remoteRoom).toBe("W8N8");
  });

  it("returns undefined and does not persist anything while candidates are still unscouted", () => {
    vi.stubGlobal("Game", {
      map: { describeExits: vi.fn().mockReturnValue({ "1": "W9N9", "3": "W8N8" }) }
    });
    const homeMemory: RoomMemory = {};

    const result = resolveRemoteRoom("W9N8", homeMemory, {
      W9N9: { remoteIntel: intel() }
    });

    expect(result).toBeUndefined();
    expect(homeMemory.remoteRoom).toBeUndefined();
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
