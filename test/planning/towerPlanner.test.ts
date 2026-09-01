import { describe, expect, it } from "vitest";
import { findTowerSite } from "../../src/planning/towerPlanner";

const allWalkable = () => true;
const noneOccupied = () => false;

describe("findTowerSite", () => {
  it("finds the nearest free tile to the anchor", () => {
    const anchor = { x: 25, y: 25 };

    const result = findTowerSite(allWalkable, noneOccupied, anchor);

    expect(result).not.toBeNull();
    const distance = Math.max(Math.abs(result!.x - anchor.x), Math.abs(result!.y - anchor.y));
    expect(distance).toBe(1);
  });

  it("skips tiles that are not walkable", () => {
    const anchor = { x: 10, y: 10 };
    const isWalkable = (x: number, y: number) => !(x === 9 && y === 9);

    const result = findTowerSite(isWalkable, noneOccupied, anchor);

    expect(result).not.toEqual({ x: 9, y: 9 });
  });

  it("skips tiles that are already occupied", () => {
    const anchor = { x: 10, y: 10 };
    const isOccupied = (x: number, y: number) => x === 9 && y === 9;

    const result = findTowerSite(allWalkable, isOccupied, anchor);

    expect(result).not.toEqual({ x: 9, y: 9 });
  });

  it("returns null when nothing is available within the search radius", () => {
    const anchor = { x: 10, y: 10 };

    const result = findTowerSite(() => false, noneOccupied, anchor);

    expect(result).toBeNull();
  });

  it("never returns a position outside the 0-49 room bounds", () => {
    const anchor = { x: 0, y: 0 };

    const result = findTowerSite(allWalkable, noneOccupied, anchor);

    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(0);
    expect(result!.y).toBeGreaterThanOrEqual(0);
    expect(result!.x).toBeLessThanOrEqual(49);
    expect(result!.y).toBeLessThanOrEqual(49);
  });
});
