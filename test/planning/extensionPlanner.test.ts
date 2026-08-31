import { describe, expect, it } from "vitest";
import { findExtensionSite } from "../../src/planning/extensionPlanner";

const allWalkable = () => true;
const noneOccupied = () => false;

describe("findExtensionSite", () => {
  it("finds the nearest valid checkerboard tile to the anchor", () => {
    const anchor = { x: 25, y: 25 };

    const result = findExtensionSite(allWalkable, noneOccupied, anchor);

    expect(result).not.toBeNull();
    expect((result!.x + result!.y) % 2).toBe(0);
    const distance = Math.max(Math.abs(result!.x - anchor.x), Math.abs(result!.y - anchor.y));
    expect(distance).toBeGreaterThanOrEqual(2);
    expect(distance).toBeLessThanOrEqual(3);
  });

  it("skips tiles that are not walkable", () => {
    const anchor = { x: 10, y: 10 };
    const isWalkable = (x: number, y: number) => !(x === 12 && y === 10);

    const result = findExtensionSite(isWalkable, noneOccupied, anchor);

    expect(result).not.toEqual({ x: 12, y: 10 });
  });

  it("skips tiles that are already occupied", () => {
    const anchor = { x: 10, y: 10 };
    const isOccupied = (x: number, y: number) => x === 12 && y === 10;

    const result = findExtensionSite(allWalkable, isOccupied, anchor);

    expect(result).not.toEqual({ x: 12, y: 10 });
  });

  it("only returns tiles on the checkerboard parity", () => {
    const anchor = { x: 10, y: 10 };

    const result = findExtensionSite(allWalkable, noneOccupied, anchor);

    expect((result!.x + result!.y) % 2).toBe(0);
  });

  it("returns null when nothing is available within the search radius", () => {
    const anchor = { x: 10, y: 10 };

    const result = findExtensionSite(() => false, noneOccupied, anchor);

    expect(result).toBeNull();
  });

  it("never returns a position outside the 0-49 room bounds", () => {
    const anchor = { x: 0, y: 0 };

    const result = findExtensionSite(allWalkable, noneOccupied, anchor);

    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(0);
    expect(result!.y).toBeGreaterThanOrEqual(0);
    expect(result!.x).toBeLessThanOrEqual(49);
    expect(result!.y).toBeLessThanOrEqual(49);
  });
});
