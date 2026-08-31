import { describe, expect, it } from "vitest";
import { detectNewHostiles } from "../../src/logging/hostiles";

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
