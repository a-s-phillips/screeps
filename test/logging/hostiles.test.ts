import { afterEach, describe, expect, it, vi } from "vitest";
import { detectNewHostiles, recordHostileSighting } from "../../src/logging/hostiles";

function mockHostile(
  id: string,
  owner: string,
  room: string,
  bodyTypes: BodyPartConstant[]
): Creep {
  return {
    id,
    owner: { username: owner },
    room: { name: room },
    body: bodyTypes.map((type) => ({ type, hits: 100 }))
  } as unknown as Creep;
}

describe("detectNewHostiles", () => {
  it("reports a sighting for a hostile creep not seen before", () => {
    const hostile = mockHostile("h1", "CrazyPagi", "W1N1", [ATTACK, MOVE]);

    const result = detectNewHostiles([hostile], new Set());

    expect(result.sightings).toEqual([
      { owner: "CrazyPagi", room: "W1N1", hasAttack: true, hasRanged: false, hasHeal: false }
    ]);
    expect(result.seenIds.has("h1")).toBe(true);
  });

  it("does not re-report a hostile creep already in the seen set", () => {
    const hostile = mockHostile("h1", "CrazyPagi", "W1N1", [ATTACK]);

    const result = detectNewHostiles([hostile], new Set(["h1"]));

    expect(result.sightings).toEqual([]);
  });

  it("summarizes body parts correctly for a ranged healer", () => {
    const hostile = mockHostile("h2", "SomePlayer", "W2N2", [RANGED_ATTACK, HEAL, MOVE]);

    const result = detectNewHostiles([hostile], new Set());

    expect(result.sightings).toEqual([
      { owner: "SomePlayer", room: "W2N2", hasAttack: false, hasRanged: true, hasHeal: true }
    ]);
  });

  it("returns no sightings when there are no hostiles", () => {
    const result = detectNewHostiles([], new Set());

    expect(result.sightings).toEqual([]);
    expect(result.seenIds.size).toBe(0);
  });
});

describe("recordHostileSighting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps lastHostileSeenTick with the current tick when hostiles are present", () => {
    vi.stubGlobal("Game", { time: 12345 });
    const hostile = mockHostile("h1", "CrazyPagi", "W1N1", [ATTACK]);
    const memory: RoomMemory = {};

    recordHostileSighting(memory, [hostile]);

    expect(memory.lastHostileSeenTick).toBe(12345);
  });

  it("does not touch lastHostileSeenTick when there are no hostiles", () => {
    vi.stubGlobal("Game", { time: 12345 });
    const memory: RoomMemory = { lastHostileSeenTick: 100 };

    recordHostileSighting(memory, []);

    expect(memory.lastHostileSeenTick).toBe(100);
  });

  // A reserver (claim + move) sitting on a remote room's controller is a permanent,
  // harmless presence - counting it as "hostile" would keep isRoomHostile() true
  // forever and permanently evict our own remote creeps from an otherwise-safe room.
  it("does not touch lastHostileSeenTick when the only creeps present are unarmed", () => {
    vi.stubGlobal("Game", { time: 12345 });
    const reserver = mockHostile("h1", "SomePlayer", "W1N1", [CLAIM, MOVE]);
    const memory: RoomMemory = {};

    recordHostileSighting(memory, [reserver]);

    expect(memory.lastHostileSeenTick).toBeUndefined();
  });

  it("stamps lastHostileSeenTick when a ranged attacker is present", () => {
    vi.stubGlobal("Game", { time: 12345 });
    const attacker = mockHostile("h1", "SomePlayer", "W1N1", [RANGED_ATTACK, MOVE]);
    const memory: RoomMemory = {};

    recordHostileSighting(memory, [attacker]);

    expect(memory.lastHostileSeenTick).toBe(12345);
  });

  it("stamps lastHostileSeenTick when at least one of several creeps is armed", () => {
    vi.stubGlobal("Game", { time: 12345 });
    const reserver = mockHostile("h1", "SomePlayer", "W1N1", [CLAIM, MOVE]);
    const attacker = mockHostile("h2", "SomePlayer", "W1N1", [ATTACK, MOVE]);
    const memory: RoomMemory = {};

    recordHostileSighting(memory, [reserver, attacker]);

    expect(memory.lastHostileSeenTick).toBe(12345);
  });
});
