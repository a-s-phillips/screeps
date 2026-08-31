import { log } from "../logging/logger";
import { getCachedFind } from "../utils/roomCache";
import { findExtensionSite } from "./extensionPlanner";

export function planRoom(room: Room): void {
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
  occupied.add(`${room.controller.pos.x},${room.controller.pos.y}`);

  const isWalkable = (x: number, y: number) => terrain.get(x, y) !== TERRAIN_MASK_WALL;
  const isOccupied = (x: number, y: number) => occupied.has(`${x},${y}`);

  const site = findExtensionSite(isWalkable, isOccupied, { x: spawn.pos.x, y: spawn.pos.y });
  if (!site) return;

  const result = room.createConstructionSite(site.x, site.y, STRUCTURE_EXTENSION);
  if (result === OK) {
    log("construction_site_planned", { room: room.name, x: site.x, y: site.y });
  }
}
