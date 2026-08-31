import { describe, expect, it } from "vitest";
import { bodyCost, planBody } from "../../src/spawn/bodyPlanner";

describe("planBody", () => {
  it("returns an empty body when there isn't enough energy capacity for even one block", () => {
    expect(planBody("upgrader", 199)).toEqual([]);
    expect(planBody("harvester", 299)).toEqual([]);
  });

  it("returns exactly one base block when capacity matches its cost", () => {
    expect(planBody("upgrader", 200)).toEqual([WORK, CARRY, MOVE]);
    expect(planBody("builder", 200)).toEqual([WORK, CARRY, MOVE]);
    expect(planBody("harvester", 300)).toEqual([WORK, WORK, CARRY, MOVE]);
  });

  it("repeats the block as many times as the capacity budget allows", () => {
    expect(planBody("upgrader", 450)).toEqual([WORK, CARRY, MOVE, WORK, CARRY, MOVE]);
  });

  it("never exceeds MAX_CREEP_SIZE parts or the capacity budget, even with unlimited capacity", () => {
    for (const role of ["upgrader", "builder"] as const) {
      const body = planBody(role, 50_000);
      const cost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);

      expect(body.length).toBeLessThanOrEqual(MAX_CREEP_SIZE);
      expect(cost).toBeLessThanOrEqual(50_000);
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it("caps harvester WORK parts at the source-saturation limit even with unlimited capacity", () => {
    // A source regenerates 3000/300 = 10 energy/tick; each WORK part harvests 2/tick,
    // so 5 WORK parts saturates one source. The harvester block has 2 WORK parts per
    // repeat, so the cap is floor(5/2) = 2 repeats (4 WORK parts), not MAX_CREEP_SIZE.
    const body = planBody("harvester", 50_000);

    expect(body).toEqual([WORK, WORK, CARRY, MOVE, WORK, WORK, CARRY, MOVE]);
    expect(body.filter((part) => part === WORK)).toHaveLength(4);
  });

  it("caps harvester at 2 block repeats even when the budget affords a 3rd", () => {
    // 3 harvester blocks cost 900, well within budget, but the role cap stops it at 2.
    const body = planBody("harvester", 900);

    expect(body).toEqual([WORK, WORK, CARRY, MOVE, WORK, WORK, CARRY, MOVE]);
  });
});

describe("bodyCost", () => {
  it("sums BODYPART_COST across all parts", () => {
    expect(bodyCost([WORK, CARRY, MOVE])).toBe(200);
    expect(bodyCost([WORK, WORK, CARRY, MOVE])).toBe(300);
    expect(bodyCost([])).toBe(0);
  });
});
