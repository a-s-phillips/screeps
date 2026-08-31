const ROOM_MIN = 0;
const ROOM_MAX = 49;

export interface Point {
  x: number;
  y: number;
}

export function inBounds(point: Point): boolean {
  return point.x >= ROOM_MIN && point.x <= ROOM_MAX && point.y >= ROOM_MIN && point.y <= ROOM_MAX;
}

export function tilesAtRing(anchor: Point, radius: number): Point[] {
  const tiles: Point[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      tiles.push({ x: anchor.x + dx, y: anchor.y + dy });
    }
  }
  return tiles;
}

export function chebyshevDistance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
