import { isRoomHostile } from "../planning/remoteTargeting";
import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";

export const MOVE_OPTS: MoveToOpts = { reusePath: 5 };
// Cross-room trips are long and mostly unroaded/static terrain, so a much longer path
// cache is worth it - a local reusePath of 5 would recompute the whole route far more
// often than the terrain along the way ever actually changes.
export const REMOTE_MOVE_OPTS: MoveToOpts = { reusePath: 20 };

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
// reset. Returns true when the creep is retreating, so callers can skip their normal
// remote-room work for the tick.
export function retreatFromHostileRemote(
  creep: Creep,
  remoteRoomName: string,
  homeRoomName?: string
): boolean {
  if (!isRoomHostile(Memory.rooms[remoteRoomName]?.lastHostileSeenTick, Game.time)) return false;
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

// Spawn, extensions, and towers are treated as one pool rather than spawn/extension-first:
// a strict priority tier left towers permanently starved in practice, because extensions
// rarely sit at 100% full in an active colony (creeps constantly draw them down on spawn),
// so the tower's "leftovers" tier almost never triggered. Closest-need-wins still keeps
// spawning covered in the common case, since extensions cluster near the spawn.
export function deliverEnergy(creep: Creep): boolean {
  const targets = getCachedFind(creep.room, FIND_MY_STRUCTURES).filter(
    (structure): structure is StructureSpawn | StructureExtension | StructureTower =>
      (structure.structureType === STRUCTURE_SPAWN ||
        structure.structureType === STRUCTURE_EXTENSION ||
        structure.structureType === STRUCTURE_TOWER) &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  const target = creep.pos.findClosestByPath(targets);
  if (!target) return false;

  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, MOVE_OPTS);
  }
  return true;
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

export function withdrawFromFullestContainer(creep: Creep, exclude?: StructureContainer): boolean {
  const target = findFullestContainer(creep, exclude);
  if (!target) return false;

  if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
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
