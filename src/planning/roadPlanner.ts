import { log } from "../logging/logger";
import { getCachedFind } from "../utils/roomCache";

interface RoadTile {
  x: number;
  y: number;
}

function computeRoadPlan(
  room: Room,
  spawn: StructureSpawn,
  controller: StructureController
): RoadTile[] {
  const destinations: RoomPosition[] = [
    ...getCachedFind(room, FIND_SOURCES).map((source) => source.pos),
    controller.pos
  ];

  const seen = new Set<string>();
  const tiles: RoadTile[] = [];

  for (const destination of destinations) {
    // range: 1 keeps roads off the source/controller tile itself — those are unwalkable,
    // so a range-0 path lands a road there at the 150x wall-terrain cost multiplier.
    const path = room.findPath(spawn.pos, destination, {
      ignoreCreeps: true,
      ignoreRoads: true,
      range: 1
    });
    for (const step of path) {
      const key = `${step.x},${step.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ x: step.x, y: step.y });
    }
  }

  return tiles;
}

// Returns whether the road queue is empty (every planned tile already has a built or
// pending road) - used by the room planner to gate lower-priority construction (e.g.
// towers) behind higher-priority roads being done.
export function planRoads(room: Room, memory: RoomMemory): boolean {
  if (!room.controller) return false;

  if (!memory.roadPlan) {
    const spawn = getCachedFind(room, FIND_MY_SPAWNS)[0];
    if (!spawn) return false;
    memory.roadPlan = computeRoadPlan(room, spawn, room.controller);
  }

  const builtRoadPositions = new Set(
    getCachedFind(room, FIND_STRUCTURES)
      .filter((structure) => structure.structureType === STRUCTURE_ROAD)
      .map((structure) => `${structure.pos.x},${structure.pos.y}`)
  );
  const pendingRoadPositions = new Set(
    getCachedFind(room, FIND_MY_CONSTRUCTION_SITES)
      .filter((site) => site.structureType === STRUCTURE_ROAD)
      .map((site) => `${site.pos.x},${site.pos.y}`)
  );

  for (const tile of memory.roadPlan) {
    const key = `${tile.x},${tile.y}`;
    if (builtRoadPositions.has(key) || pendingRoadPositions.has(key)) continue;

    const result = room.createConstructionSite(tile.x, tile.y, STRUCTURE_ROAD);
    if (result === OK) {
      log("construction_site_planned", {
        room: room.name,
        x: tile.x,
        y: tile.y,
        structureType: STRUCTURE_ROAD
      });
    }
    return false;
  }

  return true;
}
