import { log } from "../logging/logger";
import { chebyshevDistance, Point } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import { findContainerSite } from "./containerPlanner";
import { findExtensionSite } from "./extensionPlanner";
import { planRoads } from "./roadPlanner";
import { findTowerSite } from "./towerPlanner";

// Ticks a hostile sighting keeps the tower/rampart-priority gate open after last seen - tune freely.
export const HOSTILE_MEMORY_WINDOW = 1000;
// Flip to true (and redeploy) to force tower/rampart construction now, bypassing the gates below.
export const TOWER_PRIORITY_OVERRIDE = false;

// Shared by tower priority, rampart priority, and (in spawnManager.ts) the defender
// spawn trigger - one source of truth for "is this room's hostile sighting still
// fresh" so the three can't drift out of sync on what counts as under threat.
export function isLocalHostileRecentlySeen(
  lastHostileSeenTick: number | undefined,
  now: number
): boolean {
  return lastHostileSeenTick !== undefined && now - lastHostileSeenTick <= HOSTILE_MEMORY_WINDOW;
}

function buildOccupancy(room: Room): {
  isWalkable: (x: number, y: number) => boolean;
  isOccupied: (x: number, y: number) => boolean;
} {
  const terrain = room.getTerrain();
  const occupied = new Set<string>();
  // Roads don't block other structures in Screeps - they coexist with almost anything,
  // including on the single walkable tile adjacent to a source. Treating them as
  // occupied here permanently starved sources of their only viable container tile
  // whenever roadPlanner's spawn->source pathing landed there first.
  for (const structure of getCachedFind(room, FIND_STRUCTURES)) {
    if (structure.structureType === STRUCTURE_ROAD) continue;
    occupied.add(`${structure.pos.x},${structure.pos.y}`);
  }
  for (const site of getCachedFind(room, FIND_CONSTRUCTION_SITES)) {
    if (site.structureType === STRUCTURE_ROAD) continue;
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

// Returns whether the extension queue is empty (at/over cap, nothing left to build) -
// used by the room planner to gate lower-priority construction (e.g. towers) behind
// higher-priority extensions being done.
function planExtensions(room: Room): boolean {
  if (!room.controller) return false;

  const allowed = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller.level] ?? 0;

  const existingExtensions = getCachedFind(room, FIND_MY_STRUCTURES).filter(
    (structure) => structure.structureType === STRUCTURE_EXTENSION
  ).length;
  const pendingExtensionSites = getCachedFind(room, FIND_MY_CONSTRUCTION_SITES).filter(
    (site) => site.structureType === STRUCTURE_EXTENSION
  ).length;

  if (existingExtensions + pendingExtensionSites >= allowed) return true;

  const spawn = getCachedFind(room, FIND_MY_SPAWNS)[0];
  if (!spawn) return false;

  const { isWalkable, isOccupied } = buildOccupancy(room);
  const site = findExtensionSite(isWalkable, isOccupied, { x: spawn.pos.x, y: spawn.pos.y });
  if (!site) return false;

  const result = room.createConstructionSite(site.x, site.y, STRUCTURE_EXTENSION);
  if (result === OK) {
    log("construction_site_planned", {
      room: room.name,
      x: site.x,
      y: site.y,
      structureType: STRUCTURE_EXTENSION
    });
  }
  return false;
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

  // Only anchor on the controller when we own it - a remote-mining target's controller
  // isn't something we'll ever benefit from upgrading, so it shouldn't burn one of the
  // (flat, RCL-0-allowed) 5 container slots.
  const anchors: Point[] = [
    ...getCachedFind(room, FIND_SOURCES).map((source) => ({ x: source.pos.x, y: source.pos.y })),
    ...(room.controller.my ? [{ x: room.controller.pos.x, y: room.controller.pos.y }] : [])
  ];

  for (const anchor of anchors) {
    const hasNearbyContainer = containerPositions.some(
      (pos) => chebyshevDistance(pos, anchor) <= 1
    );
    if (hasNearbyContainer) continue;

    const site = findContainerSite(isWalkable, isOccupied, anchor);
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

// Only queues a tower once it won't compete with higher-priority construction: the
// extension/road queues are both empty, a hostile has been seen recently, or a human
// has explicitly flipped the override. `overridePriority` is an explicit parameter
// (defaulting to the module constant) rather than read directly, so this branch stays
// unit-testable without mutating shared module state.
export function planTowers(
  room: Room,
  hostileRecentlySeen: boolean,
  essentialQueueEmpty: boolean,
  overridePriority = TOWER_PRIORITY_OVERRIDE
): void {
  if (!room.controller) return;

  const allowed = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][room.controller.level] ?? 0;

  const existingTowers = getCachedFind(room, FIND_MY_STRUCTURES).filter(
    (structure) => structure.structureType === STRUCTURE_TOWER
  ).length;
  const pendingTowerSites = getCachedFind(room, FIND_MY_CONSTRUCTION_SITES).filter(
    (site) => site.structureType === STRUCTURE_TOWER
  ).length;

  if (existingTowers + pendingTowerSites >= allowed) return;

  if (!overridePriority && !hostileRecentlySeen && !essentialQueueEmpty) return;

  const spawn = getCachedFind(room, FIND_MY_SPAWNS)[0];
  if (!spawn) return;

  const { isWalkable, isOccupied } = buildOccupancy(room);
  const site = findTowerSite(isWalkable, isOccupied, { x: spawn.pos.x, y: spawn.pos.y });
  if (!site) return;

  const result = room.createConstructionSite(site.x, site.y, STRUCTURE_TOWER);
  if (result === OK) {
    log("construction_site_planned", {
      room: room.name,
      x: site.x,
      y: site.y,
      structureType: STRUCTURE_TOWER
    });
  }
}

// Ramparts stack directly on the tile of the structure they protect - unlike every
// other structure type, Screeps allows a rampart construction site on an already-
// occupied tile (that's the entire point: it shields whatever's underneath). No ring
// search needed - the anchor tile is already valid by definition of having a spawn or
// tower on it. Same priority gate as planTowers (essential queue empty, hostile
// recently seen, or override), sharing TOWER_PRIORITY_OVERRIDE rather than a second
// constant, since both are "defensive investment" construction.
export function planRamparts(
  room: Room,
  hostileRecentlySeen: boolean,
  essentialQueueEmpty: boolean,
  overridePriority = TOWER_PRIORITY_OVERRIDE
): void {
  if (!room.controller) return;

  const allowed = CONTROLLER_STRUCTURES[STRUCTURE_RAMPART][room.controller.level] ?? 0;

  const myStructures = getCachedFind(room, FIND_MY_STRUCTURES);
  const existingRamparts = myStructures.filter(
    (structure) => structure.structureType === STRUCTURE_RAMPART
  );
  const pendingRampartSites = getCachedFind(room, FIND_MY_CONSTRUCTION_SITES).filter(
    (site) => site.structureType === STRUCTURE_RAMPART
  );

  if (existingRamparts.length + pendingRampartSites.length >= allowed) return;

  if (!overridePriority && !hostileRecentlySeen && !essentialQueueEmpty) return;

  const rampartedPositions: Point[] = [...existingRamparts, ...pendingRampartSites].map(
    (structure) => structure.pos
  );

  const spawn = getCachedFind(room, FIND_MY_SPAWNS)[0];
  const towers = myStructures.filter((structure) => structure.structureType === STRUCTURE_TOWER);
  const anchors: Point[] = [
    ...(spawn ? [{ x: spawn.pos.x, y: spawn.pos.y }] : []),
    ...towers.map((tower) => ({ x: tower.pos.x, y: tower.pos.y }))
  ];

  for (const anchor of anchors) {
    const hasRampart = rampartedPositions.some(
      (pos) => pos.x === anchor.x && pos.y === anchor.y
    );
    if (hasRampart) continue;

    const result = room.createConstructionSite(anchor.x, anchor.y, STRUCTURE_RAMPART);
    if (result === OK) {
      log("construction_site_planned", {
        room: room.name,
        x: anchor.x,
        y: anchor.y,
        structureType: STRUCTURE_RAMPART
      });
      return;
    }
  }
}

// Extensions/towers require ownership to build at all (and are already self-gated by
// the RCL-0 CONTROLLER_STRUCTURES table for an unowned controller); roads aren't useful
// without a colony to connect. Containers are the exception - allowed at RCL 0, and
// exactly what a remote-mining target needs - so they're planned for an owned room OR
// a room explicitly passed in as some home room's chosen remote target, never for a
// room that's merely visible (e.g. one a scout is passing through).
export function planRoom(
  room: Room,
  memory: RoomMemory,
  isOwnedOrRemoteTarget: boolean = room.controller?.my ?? false
): void {
  if (!room.controller?.my) {
    if (isOwnedOrRemoteTarget) planContainers(room);
    return;
  }

  const extensionsDone = planExtensions(room);
  planContainers(room);
  const roadsDone = planRoads(room, memory);
  const hostileRecentlySeen = isLocalHostileRecentlySeen(memory.lastHostileSeenTick, Game.time);
  const essentialQueueEmpty = extensionsDone && roadsDone;
  planTowers(room, hostileRecentlySeen, essentialQueueEmpty);
  planRamparts(room, hostileRecentlySeen, essentialQueueEmpty);
}
