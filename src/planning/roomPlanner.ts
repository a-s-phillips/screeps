import { log } from "../logging/logger";
import { chebyshevDistance, Point } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import { findContainerSite } from "./containerPlanner";
import { findExtensionSite } from "./extensionPlanner";

function buildOccupancy(room: Room): {
  isWalkable: (x: number, y: number) => boolean;
  isOccupied: (x: number, y: number) => boolean;
} {
  const terrain = room.getTerrain();
  const occupied = new Set<string>();
  for (const structure of getCachedFind(room, FIND_STRUCTURES)) {
    occupied.add(`${structure.pos.x},${structure.pos.y}`);
  }
  for (const site of getCachedFind(room, FIND_CONSTRUCTION_SITES)) {
    occupied.add(`${site.pos.x},${site.pos.y}`);
  }
  for (const source of getCachedFind(room, FIND_SOURCES)) {
    occupied.add(`${source.pos.x},${source.pos.y}`);
  }
  if (room.controller) occupied.add(`${room.controller.pos.x},${room.controller.pos.y}`);

  return {
    isWalkable: (x, y) => terrain.get(x, y) !== TERRAIN_MASK_WALL,
    isOccupied: (x, y) => occupied.has(`${x},${y}`)
  };
}

function planExtensions(room: Room): void {
  if (!room.controller) return;

  const allowed = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller.level] ?? 0;

  const existingExtensions = getCachedFind(room, FIND_MY_STRUCTURES).filter(
    (structure) => structure.structureType === STRUCTURE_EXTENSION
  ).length;
  const pendingExtensionSites = getCachedFind(room, FIND_MY_CONSTRUCTION_SITES).filter(
    (site) => site.structureType === STRUCTURE_EXTENSION
  ).length;

  if (existingExtensions + pendingExtensionSites >= allowed) return;

  const spawn = getCachedFind(room, FIND_MY_SPAWNS)[0];
  if (!spawn) return;

  const { isWalkable, isOccupied } = buildOccupancy(room);
  const site = findExtensionSite(isWalkable, isOccupied, { x: spawn.pos.x, y: spawn.pos.y });
  if (!site) return;

  const result = room.createConstructionSite(site.x, site.y, STRUCTURE_EXTENSION);
  if (result === OK) {
    log("construction_site_planned", {
      room: room.name,
      x: site.x,
      y: site.y,
      structureType: STRUCTURE_EXTENSION
    });
  }
}

function planContainers(room: Room): void {
  if (!room.controller) return;

  const allowed = CONTROLLER_STRUCTURES[STRUCTURE_CONTAINER][room.controller.level] ?? 0;

  const existingContainers = getCachedFind(room, FIND_STRUCTURES).filter(
    (structure) => structure.structureType === STRUCTURE_CONTAINER
  );
  const pendingContainerSites = getCachedFind(room, FIND_MY_CONSTRUCTION_SITES).filter(
    (site) => site.structureType === STRUCTURE_CONTAINER
  );

  if (existingContainers.length + pendingContainerSites.length >= allowed) return;

  const { isWalkable, isOccupied } = buildOccupancy(room);
  const containerPositions: Point[] = [...existingContainers, ...pendingContainerSites].map(
    (c) => c.pos
  );

  for (const source of getCachedFind(room, FIND_SOURCES)) {
    const hasNearbyContainer = containerPositions.some(
      (pos) => chebyshevDistance(pos, source.pos) <= 1
    );
    if (hasNearbyContainer) continue;

    const site = findContainerSite(isWalkable, isOccupied, { x: source.pos.x, y: source.pos.y });
    if (!site) continue;

    const result = room.createConstructionSite(site.x, site.y, STRUCTURE_CONTAINER);
    if (result === OK) {
      log("construction_site_planned", {
        room: room.name,
        x: site.x,
        y: site.y,
        structureType: STRUCTURE_CONTAINER
      });
      return;
    }
  }
}

export function planRoom(room: Room): void {
  planExtensions(room);
  planContainers(room);
}
