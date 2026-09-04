import { inBounds, Point, tilesAtRing } from "../utils/grid";

export function findLinkSite(
  isWalkable: (x: number, y: number) => boolean,
  isOccupied: (x: number, y: number) => boolean,
  anchor: Point
): Point | null {
  for (const tile of tilesAtRing(anchor, 1)) {
    if (!inBounds(tile)) continue;
    if (!isWalkable(tile.x, tile.y)) continue;
    if (isOccupied(tile.x, tile.y)) continue;
    return tile;
  }
  return null;
}
