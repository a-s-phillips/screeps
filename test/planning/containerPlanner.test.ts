import { describe, expect, it } from "vitest";
import { findContainerSite } from "../../src/planning/containerPlanner";
import { chebyshevDistance } from "../../src/utils/grid";

const allWalkable = () => true;
const noneOccupied = () => false;

describe("findContainerSite", () => {
  it("finds a tile adjacent to the source", () => {
    const source = { x: 25, y: 25 };

    const result = findContainerSite(allWalkable, noneOccupied, source);

    expect(result).not.toBeNull();
    expect(chebyshevDistance(result!, source)).toBe(1);
  });

  it("skips tiles that are not walkable", () => {
    const source = { x: 10, y: 10 };
    const isWalkable = (x: number, y: number) => !(x === 9 && y === 9);

    const result = findContainerSite(isWalkable, noneOccupied, source);

    expect(result).not.toEqual({ x: 9, y: 9 });
  });

  it("skips tiles that are already occupied", () => {
    const source = { x: 10, y: 10 };
    const isOccupied = (x: number, y: number) => x === 9 && y === 9;

    const result = findContainerSite(allWalkable, isOccupied, source);

    expect(result).not.toEqual({ x: 9, y: 9 });
  });

  it("returns null when every adjacent tile is blocked", () => {
    const source = { x: 10, y: 10 };

    const result = findContainerSite(() => false, noneOccupied, source);

    expect(result).toBeNull();
  });

  it("never returns a position outside the 0-49 room bounds", () => {
    const source = { x: 0, y: 0 };

    const result = findContainerSite(allWalkable, noneOccupied, source);

    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(0);
    expect(result!.y).toBeGreaterThanOrEqual(0);
    expect(result!.x).toBeLessThanOrEqual(49);
    expect(result!.y).toBeLessThanOrEqual(49);
  });
});
