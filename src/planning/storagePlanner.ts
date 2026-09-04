import { inBounds, Point, tilesAtRing } from "../utils/grid";

const MIN_RADIUS = 1;
const MAX_RADIUS = 8;

export function findStorageSite(
  isWalkable: (x: number, y: number) => boolean,
  isOccupied: (x: number, y: number) => boolean,
  anchor: Point
): Point | null {
  for (let radius = MIN_RADIUS; radius <= MAX_RADIUS; radius++) {
    for (const tile of tilesAtRing(anchor, radius)) {
      if (!inBounds(tile)) continue;
      if (!isWalkable(tile.x, tile.y)) continue;
      if (isOccupied(tile.x, tile.y)) continue;
      return tile;
    }
  }
  return null;
}
