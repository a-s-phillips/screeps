import { describe, expect, it } from "vitest";
import { detectHostileKills } from "../../src/logging/hostileKills";

function mockTombstone(id: string, owner: string, room: string, my: boolean): Tombstone {
  return {
    id,
    room: { name: room },
    creep: { my, owner: { username: owner } }
  } as unknown as Tombstone;
}

describe("detectHostileKills", () => {
  it("reports a kill for a hostile tombstone not seen before", () => {
    const tombstone = mockTombstone("t1", "CrazyPagi", "W1N1", false);

    const result = detectHostileKills([tombstone], new Set());

    expect(result.kills).toEqual([{ owner: "CrazyPagi", room: "W1N1" }]);
    expect(result.seenIds.has("t1")).toBe(true);
  });

  it("does not re-report a tombstone already in the seen set", () => {
    const tombstone = mockTombstone("t1", "CrazyPagi", "W1N1", false);

    const result = detectHostileKills([tombstone], new Set(["t1"]));

    expect(result.kills).toEqual([]);
  });

  it("ignores tombstones belonging to our own creeps", () => {
    const tombstone = mockTombstone("t1", "MyUsername", "W1N1", true);

    const result = detectHostileKills([tombstone], new Set());

    expect(result.kills).toEqual([]);
    // Own-creep tombstones are still worth remembering, so a later global reset
    // doesn't re-evaluate (and still correctly skip) the same tombstone.
    expect(result.seenIds.has("t1")).toBe(true);
  });

  it("returns no kills when there are no tombstones", () => {
    const result = detectHostileKills([], new Set());

    expect(result.kills).toEqual([]);
    expect(result.seenIds.size).toBe(0);
  });

  it("reports multiple distinct hostile kills in the same tick", () => {
    const t1 = mockTombstone("t1", "CrazyPagi", "W1N1", false);
    const t2 = mockTombstone("t2", "SomePlayer", "W1N1", false);

    const result = detectHostileKills([t1, t2], new Set());

    expect(result.kills).toEqual([
      { owner: "CrazyPagi", room: "W1N1" },
      { owner: "SomePlayer", room: "W1N1" }
    ]);
  });
});
