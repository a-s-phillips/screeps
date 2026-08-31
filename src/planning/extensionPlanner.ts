import { inBounds, Point, tilesAtRing } from "../utils/grid";

const MIN_RADIUS = 2;
const MAX_RADIUS = 8;

export function findExtensionSite(
  isWalkable: (x: number, y: number) => boolean,
  isOccupied: (x: number, y: number) => boolean,
  anchor: Point
): Point | null {
  for (let radius = MIN_RADIUS; radius <= MAX_RADIUS; radius++) {
    for (const tile of tilesAtRing(anchor, radius)) {
      if (!inBounds(tile)) continue;
      if ((tile.x + tile.y) % 2 !== 0) continue;
      if (!isWalkable(tile.x, tile.y)) continue;
      if (isOccupied(tile.x, tile.y)) continue;
      return tile;
    }
  }
  return null;
}
