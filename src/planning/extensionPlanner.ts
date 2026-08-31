const ROOM_MIN = 0;
const ROOM_MAX = 49;
const MIN_RADIUS = 2;
const MAX_RADIUS = 8;

export interface Point {
  x: number;
  y: number;
}

function tilesAtRing(anchor: Point, radius: number): Point[] {
  const tiles: Point[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      tiles.push({ x: anchor.x + dx, y: anchor.y + dy });
    }
  }
  return tiles;
}

function inBounds(point: Point): boolean {
  return point.x >= ROOM_MIN && point.x <= ROOM_MAX && point.y >= ROOM_MIN && point.y <= ROOM_MAX;
}

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
