import { describe, expect, it } from "vitest";
import { isNearingDeath, replacementLeadTime } from "../../src/spawn/preSpawn";

describe("replacementLeadTime", () => {
  it("combines spawn time (bodyLength * CREEP_SPAWN_TIME) and travel distance", () => {
    expect(replacementLeadTime(3, 10)).toBe(3 * CREEP_SPAWN_TIME + 10);
  });

  it("is just spawn time when travel distance is zero", () => {
    expect(replacementLeadTime(5, 0)).toBe(5 * CREEP_SPAWN_TIME);
  });
});

describe("isNearingDeath", () => {
  it("is false when ticksToLive is undefined (still spawning)", () => {
    expect(isNearingDeath(undefined, 20)).toBe(false);
  });

  it("is false when ticksToLive is comfortably above the lead time", () => {
    expect(isNearingDeath(100, 20)).toBe(false);
  });

  it("is true when ticksToLive equals the lead time exactly", () => {
    expect(isNearingDeath(20, 20)).toBe(true);
  });

  it("is true when ticksToLive is below the lead time", () => {
    expect(isNearingDeath(5, 20)).toBe(true);
  });
});
