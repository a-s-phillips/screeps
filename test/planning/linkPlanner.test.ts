import { describe, expect, it } from "vitest";
import { findLinkSite } from "../../src/planning/linkPlanner";
import { chebyshevDistance } from "../../src/utils/grid";

const allWalkable = () => true;
const noneOccupied = () => false;

describe("findLinkSite", () => {
  it("finds a tile adjacent to the anchor", () => {
    const anchor = { x: 25, y: 25 };

    const result = findLinkSite(allWalkable, noneOccupied, anchor);

    expect(result).not.toBeNull();
    expect(chebyshevDistance(result!, anchor)).toBe(1);
  });

  it("skips tiles that are not walkable", () => {
    const anchor = { x: 10, y: 10 };
    const isWalkable = (x: number, y: number) => !(x === 9 && y === 9);

    const result = findLinkSite(isWalkable, noneOccupied, anchor);

    expect(result).not.toEqual({ x: 9, y: 9 });
  });

  it("skips tiles that are already occupied", () => {
    const anchor = { x: 10, y: 10 };
    const isOccupied = (x: number, y: number) => x === 9 && y === 9;

    const result = findLinkSite(allWalkable, isOccupied, anchor);

    expect(result).not.toEqual({ x: 9, y: 9 });
  });

  it("returns null when every adjacent tile is blocked", () => {
    const anchor = { x: 10, y: 10 };

    const result = findLinkSite(() => false, noneOccupied, anchor);

    expect(result).toBeNull();
  });

  it("never returns a position outside the 0-49 room bounds", () => {
    const anchor = { x: 0, y: 0 };

    const result = findLinkSite(allWalkable, noneOccupied, anchor);

    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(0);
    expect(result!.y).toBeGreaterThanOrEqual(0);
    expect(result!.x).toBeLessThanOrEqual(49);
    expect(result!.y).toBeLessThanOrEqual(49);
  });
});
