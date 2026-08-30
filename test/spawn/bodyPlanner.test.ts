import { describe, expect, it } from "vitest";
import { planBody } from "../../src/spawn/bodyPlanner";

describe("planBody", () => {
  it("returns an empty body when there isn't enough energy for even one block", () => {
    expect(planBody("upgrader", 199)).toEqual([]);
    expect(planBody("harvester", 299)).toEqual([]);
  });

  it("returns exactly one base block when energy matches its cost", () => {
    expect(planBody("upgrader", 200)).toEqual([WORK, CARRY, MOVE]);
    expect(planBody("builder", 200)).toEqual([WORK, CARRY, MOVE]);
    expect(planBody("harvester", 300)).toEqual([WORK, WORK, CARRY, MOVE]);
  });

  it("repeats the block as many times as the energy budget allows", () => {
    expect(planBody("upgrader", 450)).toEqual([WORK, CARRY, MOVE, WORK, CARRY, MOVE]);
  });

  it("never exceeds MAX_CREEP_SIZE parts or the energy budget, even with unlimited energy", () => {
    for (const role of ["harvester", "upgrader", "builder"] as const) {
      const body = planBody(role, 50_000);
      const cost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);

      expect(body.length).toBeLessThanOrEqual(MAX_CREEP_SIZE);
      expect(cost).toBeLessThanOrEqual(50_000);
      expect(body.length).toBeGreaterThan(0);
    }
  });
});
