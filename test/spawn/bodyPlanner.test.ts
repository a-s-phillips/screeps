import { describe, expect, it } from "vitest";
import {
  bodyCost,
  planBody,
  planMinerBody,
  planReserverBody,
  planScoutBody
} from "../../src/spawn/bodyPlanner";

describe("planBody", () => {
  it("returns an empty body when there isn't enough energy capacity for even one block", () => {
    expect(planBody("upgrader", 199)).toEqual([]);
    expect(planBody("harvester", 299)).toEqual([]);
    expect(planBody("defender", 129)).toEqual([]);
    expect(planBody("keeperHarvester", 299)).toEqual([]);
  });

  it("returns exactly one base block when capacity matches its cost", () => {
    expect(planBody("upgrader", 200)).toEqual([WORK, CARRY, MOVE]);
    expect(planBody("builder", 200)).toEqual([WORK, CARRY, MOVE]);
    expect(planBody("harvester", 300)).toEqual([WORK, WORK, CARRY, MOVE]);
    expect(planBody("hauler", 100)).toEqual([CARRY, MOVE]);
    expect(planBody("remoteHauler", 100)).toEqual([CARRY, MOVE]);
    expect(planBody("defender", 130)).toEqual([ATTACK, MOVE]);
    expect(planBody("keeperHarvester", 300)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE]);
  });

  it("repeats the block as many times as the capacity budget allows", () => {
    expect(planBody("upgrader", 450)).toEqual([WORK, CARRY, MOVE, WORK, CARRY, MOVE]);
    expect(planBody("defender", 260)).toEqual([ATTACK, MOVE, ATTACK, MOVE]);
  });

  it("never exceeds MAX_CREEP_SIZE parts or the capacity budget, even with unlimited capacity", () => {
    for (const role of [
      "upgrader",
      "builder",
      "hauler",
      "remoteHauler",
      "defender",
      "keeperHarvester"
    ] as const) {
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

describe("planMinerBody", () => {
  it("returns an empty body when there isn't enough energy for even one WORK + MOVE", () => {
    expect(planMinerBody(149)).toEqual([]);
  });

  it("returns the minimum viable body (1 WORK, 1 MOVE) at the minimum affordable capacity", () => {
    expect(planMinerBody(150)).toEqual([WORK, MOVE]);
  });

  it("scales WORK parts up with capacity, always exactly 1 MOVE", () => {
    expect(planMinerBody(250)).toEqual([WORK, WORK, MOVE]);
  });

  it("caps at the 5-WORK source-saturation limit even with unlimited capacity", () => {
    // A source regenerates 3000/300 = 10 energy/tick; each WORK part harvests 2/tick,
    // so 5 WORK parts fully saturates one source - the true ceiling this role exists
    // to hit (unlike the shared-block harvester body, which under-saturates at 4).
    expect(planMinerBody(550)).toEqual([WORK, WORK, WORK, WORK, WORK, MOVE]);
    expect(planMinerBody(50_000)).toEqual([WORK, WORK, WORK, WORK, WORK, MOVE]);
  });
});

describe("planBody for remoteHarvester", () => {
  it("uses a 1:1 MOVE ratio, unlike the local harvester's 2 WORK to 1 MOVE", () => {
    // No remote roads in v1 - a 1:1 ratio of MOVE to non-MOVE parts keeps the creep at
    // full speed on plain terrain even fully loaded, unlike the local harvester's
    // lighter 3:1 ratio (fine locally, since roads eventually cover that route).
    expect(planBody("remoteHarvester", 250)).toEqual([WORK, CARRY, MOVE, MOVE]);
  });

  it("repeats the block as capacity allows", () => {
    expect(planBody("remoteHarvester", 500)).toEqual([
      WORK,
      CARRY,
      MOVE,
      MOVE,
      WORK,
      CARRY,
      MOVE,
      MOVE
    ]);
  });
});

describe("planScoutBody", () => {
  it("is always a single MOVE part, regardless of capacity", () => {
    expect(planScoutBody()).toEqual([MOVE]);
  });
});

describe("planReserverBody", () => {
  it("is always CLAIM + MOVE, regardless of capacity", () => {
    expect(planReserverBody()).toEqual([CLAIM, MOVE]);
  });
});

describe("bodyCost", () => {
  it("sums BODYPART_COST across all parts", () => {
    expect(bodyCost([WORK, CARRY, MOVE])).toBe(200);
    expect(bodyCost([WORK, WORK, CARRY, MOVE])).toBe(300);
    expect(bodyCost([])).toBe(0);
  });
});
