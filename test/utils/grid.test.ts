import { describe, expect, it } from "vitest";
import { chebyshevDistance, inBounds, tilesAtRing } from "../../src/utils/grid";

describe("inBounds", () => {
  it("accepts points within the 0-49 room bounds", () => {
    expect(inBounds({ x: 0, y: 0 })).toBe(true);
    expect(inBounds({ x: 49, y: 49 })).toBe(true);
    expect(inBounds({ x: 25, y: 25 })).toBe(true);
  });

  it("rejects points outside the 0-49 room bounds", () => {
    expect(inBounds({ x: -1, y: 25 })).toBe(false);
    expect(inBounds({ x: 25, y: -1 })).toBe(false);
    expect(inBounds({ x: 50, y: 25 })).toBe(false);
    expect(inBounds({ x: 25, y: 50 })).toBe(false);
  });
});

describe("tilesAtRing", () => {
  it("returns just the anchor at radius 0", () => {
    expect(tilesAtRing({ x: 5, y: 5 }, 0)).toEqual([{ x: 5, y: 5 }]);
  });

  it("returns the 8 surrounding tiles at radius 1", () => {
    const tiles = tilesAtRing({ x: 5, y: 5 }, 1);

    expect(tiles).toHaveLength(8);
    for (const tile of tiles) {
      expect(Math.max(Math.abs(tile.x - 5), Math.abs(tile.y - 5))).toBe(1);
    }
    expect(tiles).not.toContainEqual({ x: 5, y: 5 });
  });

  it("returns tiles that may fall outside room bounds near the edge", () => {
    const tiles = tilesAtRing({ x: 0, y: 0 }, 1);

    expect(tiles).toContainEqual({ x: -1, y: -1 });
  });
});

describe("chebyshevDistance", () => {
  it("returns 0 for the same point", () => {
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it("returns the max axis delta, not the sum", () => {
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 1, y: 3 })).toBe(3);
  });

  it("is symmetric", () => {
    expect(chebyshevDistance({ x: 2, y: 7 }, { x: 5, y: 5 })).toBe(
      chebyshevDistance({ x: 5, y: 5 }, { x: 2, y: 7 })
    );
  });
});
