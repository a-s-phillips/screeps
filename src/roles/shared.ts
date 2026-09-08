import { isRoomHostile, isRoomOwnedByOther } from "../planning/remoteTargeting";
import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";

// maxRooms: 1 - every caller uses this once a creep is already in the room it needs to
// act in (chase a hostile, walk to a container/controller/spawn); crossing rooms is
// travelToRoom/REMOTE_MOVE_OPTS's job, never this one's. Without the cap, the pathfinder
// is technically free to route through a neighboring room if that looked cheaper -
// harmless to rule out as a contributor to a border ping-pong bug tracked down live in
// W57N24 (root cause turned out to be elsewhere - see defender.ts's anchor fallback).
export const MOVE_OPTS: MoveToOpts = { reusePath: 5, maxRooms: 1 };
// Cross-room trips are long and mostly unroaded/static terrain, so a much longer path
// cache is worth it - a local reusePath of 5 would recompute the whole route far more
// often than the terrain along the way ever actually changes.
//
// range: 1, deliberately - travelToRoom's target tile (25,25) is an arbitrary waypoint
// (see its own comment) that can be a *wall* in some rooms' generated terrain (confirmed
// live in W57N24). moveTo defaults to range: 0, requiring the creep to stand on that
// exact tile; PathFinder.search with range 0 against an unreachable goal comes back
// incomplete. range: 1 only requires getting adjacent, which is all this function ever
// actually needed - a legitimate fix in its own right, but not what was causing the
// border ping-pong bug (see defender.ts's anchor fallback for the actual mechanism and
// fix - this alone didn't stop it, confirmed live).
export const REMOTE_MOVE_OPTS: MoveToOpts = { reusePath: 20, range: 1 };

// Room center is a deliberately arbitrary waypoint - the creep doesn't care about a
// specific tile, just crossing the border, and moveTo paths across rooms it has no
// vision of via static map exit topology, then refines once it arrives.
export function travelToRoom(creep: Creep, roomName: string): boolean {
  if (creep.room.name === roomName) return true;

  creep.moveTo(new RoomPosition(25, 25, roomName), REMOTE_MOVE_OPTS);
  return false;
}

// A remote room has no towers/ramparts to fall back on, so a reserver/remoteHarvester
// already out there turns back home the moment its target room has a recent hostile
// sighting, rather than walking into (or continuing to work in) danger - resumes
// automatically once the sighting ages out of isRoomHostile's window, no extra state to
// reset. Also turns back for a room another player has claimed outright (no window to
// age out of - see isRoomOwnedByOther), since that's not a passing threat but a room
// this role can never work again unless it's lost and reclaimed. Returns true when the
// creep is retreating, so callers can skip their normal remote-room work for the tick.
export function retreatFromHostileRemote(
  creep: Creep,
  remoteRoomName: string,
  homeRoomName?: string
): boolean {
  const memory = Memory.rooms[remoteRoomName];
  const shouldRetreat =
    isRoomHostile(memory?.lastHostileSeenTick, Game.time) || isRoomOwnedByOther(memory?.remoteIntel);
  if (!shouldRetreat) return false;
  if (homeRoomName) travelToRoom(creep, homeRoomName);
  return true;
}

export function decideWorkingState(
  currentlyWorking: boolean,
  isEmpty: boolean,
  isFull: boolean
): boolean {
  if (currentlyWorking && isEmpty) return false;
  if (!currentlyWorking && isFull) return true;
  return currentlyWorking;
}

function findNearestActiveSource(creep: Creep): Source | undefined {
  const sources = getCachedFind(creep.room, FIND_SOURCES_ACTIVE);
  return creep.pos.findClosestByPath(sources) ?? undefined;
}

export function harvestFromNearestSource(creep: Creep): void {
  const target = findNearestActiveSource(creep);
  if (!target) return;

  if (creep.harvest(target) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, MOVE_OPTS);
  }
}

// The container built next to our own controller (see roomPlanner.ts's planContainers) -
// a delivery target for haulers/deliverers, never a pickup source (see
// collectFullestEnergy's exclusion). Guarded on room.controller.my so a creep
// delivering in some other room (shouldn't happen given every caller only delivers once
// home, but kept defensive per the tick-boundary convention) never mistakes an unowned
// controller's container for ours.
export function findControllerContainer(room: Room): StructureContainer | undefined {
  if (!room.controller?.my) return undefined;
  const controllerPos = room.controller.pos;

  return getCachedFind(room, FIND_STRUCTURES).find(
    (structure): structure is StructureContainer =>
      structure.structureType === STRUCTURE_CONTAINER &&
      chebyshevDistance(structure.pos, controllerPos) <= 1
  );
}

// Spawn, extensions, towers, and the controller container are treated as one pool
// rather than a strict priority chain: a strict spawn/extension-first tier left towers
// permanently starved in practice, because extensions rarely sit at 100% full in an
// active colony (creeps constantly draw them down on spawn), so the tower's "leftovers"
// tier almost never triggered. The controller container had the exact same problem one
// level further down the (former) chain - found live: haulers only ever topped it off
// once every other target was already full, which almost never happened, so it sat
// empty and upgraders had to self-haul all the way to a source container instead,
// tanking upgrade throughput well below what the room's WORK parts should produce.
// Closest-need-wins still keeps spawning covered in the common case, since extensions
// cluster near the spawn.
export interface DeliverEnergyResult {
  // Whether a delivery target was found and acted on at all (moving toward it counts) -
  // callers that just want "did this creep have delivery work to do" (harvester, hauler)
  // check this, same as the plain boolean this used to be.
  attempted: boolean;
  // Amount this tick's transfer will actually move once intents apply - 0 unless the
  // transfer call itself returned OK, since anything else (most commonly
  // ERR_NOT_IN_RANGE, still just closing distance) moves nothing.
  delivered: number;
}

export function deliverEnergy(creep: Creep): DeliverEnergyResult {
  const myTargets = getCachedFind(creep.room, FIND_MY_STRUCTURES).filter(
    (structure): structure is StructureSpawn | StructureExtension | StructureTower =>
      (structure.structureType === STRUCTURE_SPAWN ||
        structure.structureType === STRUCTURE_EXTENSION ||
        structure.structureType === STRUCTURE_TOWER) &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );

  const controllerContainer = findControllerContainer(creep.room);
  const targets: (StructureSpawn | StructureExtension | StructureTower | StructureContainer)[] = [
    ...myTargets
  ];
  if (controllerContainer && controllerContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    targets.push(controllerContainer);
  }

  // Storage is deliberately excluded from the pool above rather than added to it - its
  // effectively-unlimited free capacity would make it "closest" often enough to crowd
  // out spawn/extension/tower, reproducing the exact starvation this pool was built to
  // avoid (see the pool comment), just one tier further along. It's only ever tried once
  // nothing in that pool needs energy - an overflow valve, not a competing destination.
  // Found live: source-side containers sat capped with Storage at 0/1,000,000, because
  // nothing ever delivered to it at all.
  const target: StructureSpawn | StructureExtension | StructureTower | StructureContainer | StructureStorage | null =
    creep.pos.findClosestByPath(targets) ??
    (creep.room.storage && creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ? creep.room.storage
      : null);
  if (!target) return { attempted: false, delivered: 0 };

  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, MOVE_OPTS);
  }

  const delivered =
    result === OK
      ? Math.min(creep.store.getUsedCapacity(RESOURCE_ENERGY), target.store.getFreeCapacity(RESOURCE_ENERGY))
      : 0;
  return { attempted: true, delivered };
}

// Prefers whichever container has the biggest energy backlog over whichever is merely
// closest, tie-broken by distance. Pure "nearest" lets creeps permanently converge on
// one container while another sits full and overflows - found live: a source's
// container hit capacity and stayed there, spilling 4600+ energy onto the ground and
// decaying, because every hauler kept re-picking the other (nearer, to them) container
// instead of ever checking back on it.
function findFullestContainer(
  creep: Creep,
  exclude?: StructureContainer
): StructureContainer | undefined {
  const containers = getCachedFind(creep.room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.id !== exclude?.id &&
      structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  );
  if (containers.length === 0) return undefined;

  return containers.reduce((biggest, candidate) => {
    const biggestEnergy = biggest.store.getUsedCapacity(RESOURCE_ENERGY);
    const candidateEnergy = candidate.store.getUsedCapacity(RESOURCE_ENERGY);
    if (candidateEnergy > biggestEnergy) return candidate;
    if (candidateEnergy < biggestEnergy) return biggest;
    return chebyshevDistance(creep.pos, candidate.pos) < chebyshevDistance(creep.pos, biggest.pos)
      ? candidate
      : biggest;
  });
}

function isDroppedEnergy(candidate: StructureContainer | Resource): candidate is Resource {
  return "amount" in candidate;
}

function energyAmount(candidate: StructureContainer | Resource): number {
  return isDroppedEnergy(candidate) ? candidate.amount : candidate.store.getUsedCapacity(RESOURCE_ENERGY);
}

// Dropped energy competes for priority in the same biggest-wins pool as containers
// (see findFullestContainer above) rather than only ever being a last-resort fallback -
// a spilled pile decays a fixed amount every tick, so leaving it strictly lowest
// priority risks losing the whole pile while a hauler cycles between containers that
// aren't going anywhere. Found live: a remote room's queued construction-site energy
// spilled onto the ground after a hostile creep interrupted the builder working the
// site, and nothing in the hauler/remoteHauler pickup path ever called pickup() to
// reclaim it - it just decayed, unclaimed, indefinitely.
function findFullestEnergyPickup(
  creep: Creep,
  exclude?: StructureContainer
): StructureContainer | Resource | undefined {
  const containers = getCachedFind(creep.room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.id !== exclude?.id &&
      structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  );
  const dropped = getCachedFind(creep.room, FIND_DROPPED_RESOURCES).filter(
    (resource) => resource.resourceType === RESOURCE_ENERGY
  );

  const candidates: (StructureContainer | Resource)[] = [...containers, ...dropped];
  if (candidates.length === 0) return undefined;

  return candidates.reduce((biggest, candidate) => {
    const biggestAmount = energyAmount(biggest);
    const candidateAmount = energyAmount(candidate);
    if (candidateAmount > biggestAmount) return candidate;
    if (candidateAmount < biggestAmount) return biggest;
    return chebyshevDistance(creep.pos, candidate.pos) < chebyshevDistance(creep.pos, biggest.pos)
      ? candidate
      : biggest;
  });
}

export function collectFullestEnergy(creep: Creep, exclude?: StructureContainer): boolean {
  const target = findFullestEnergyPickup(creep, exclude);
  if (!target) return false;

  const result = isDroppedEnergy(target)
    ? creep.pickup(target)
    : creep.withdraw(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, MOVE_OPTS);
  }
  return true;
}

// Picks whichever is genuinely closer to the creep right now - the nearest active
// source, or the fullest container - rather than always trying containers first. A
// fixed "adjacent" range can't capture this correctly: build/upgrade/repair have range
// 3 while harvest has range 1, so a creep parked to build or upgrade near a source can
// easily sit outside strict source-adjacency while still being much closer to that
// source than to any container across the room. Found live: a builder parked at range 3
// from a container construction site sat at range 4 from the source it was built for -
// a fixed range-1 "adjacent" check never triggered there, even though the source was
// obviously the better pick over trekking to a container on the other side of the base.
export function gatherEnergy(creep: Creep): void {
  const nearestSource = findNearestActiveSource(creep);
  const fullestContainer = findFullestContainer(creep);

  const sourceDistance = nearestSource ? chebyshevDistance(creep.pos, nearestSource.pos) : Infinity;
  const containerDistance = fullestContainer
    ? chebyshevDistance(creep.pos, fullestContainer.pos)
    : Infinity;

  if (nearestSource && sourceDistance <= containerDistance) {
    if (creep.harvest(nearestSource) === ERR_NOT_IN_RANGE) {
      creep.moveTo(nearestSource, MOVE_OPTS);
    }
    return;
  }

  if (fullestContainer) {
    if (creep.withdraw(fullestContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(fullestContainer, MOVE_OPTS);
    }
  }
}

// Scoped narrowly to "build the pending container site in my current room" - unlike
// builder.ts's own container-priority logic, this doesn't fall back to other site types
// or the controller, since callers (remoteHarvester) have their own separate job
// (harvesting) to fall back to instead.
export function buildNearestContainerSite(creep: Creep): boolean {
  const sites = getCachedFind(creep.room, FIND_CONSTRUCTION_SITES).filter(
    (site): site is ConstructionSite<STRUCTURE_CONTAINER> =>
      site.structureType === STRUCTURE_CONTAINER
  );
  const site = creep.pos.findClosestByPath(sites);
  if (!site) return false;

  if (creep.build(site) === ERR_NOT_IN_RANGE) {
    creep.moveTo(site, MOVE_OPTS);
  }
  return true;
}

export function findAdjacentContainerWithCapacity(creep: Creep): StructureContainer | undefined {
  const containers = getCachedFind(creep.room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  return containers.find((container) => chebyshevDistance(creep.pos, container.pos) <= 1);
}

export function findContainerAtSource(source: Source): StructureContainer | undefined {
  const containers = getCachedFind(source.room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER
  );
  return containers.find((container) => chebyshevDistance(source.pos, container.pos) <= 1);
}
