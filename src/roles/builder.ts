import { getCachedFind } from "../utils/roomCache";
import { decideWorkingState, gatherEnergy, MOVE_OPTS } from "./shared";

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    gatherEnergy(creep);
    return;
  }

  const sites = getCachedFind(creep.room, FIND_CONSTRUCTION_SITES);
  // Containers unlock a miner - a real economy upgrade - so they're worth building even
  // if farther away than an extension/road, which closest-site targeting alone can't
  // guarantee: found live, a source's container sat at 0 progress indefinitely while
  // builders kept converging on closer, ever-replenishing extensions/roads instead.
  const containerSites = sites.filter(
    (candidate) => candidate.structureType === STRUCTURE_CONTAINER
  );
  // A rampart is placed directly on top of the structure it protects (see
  // roomPlanner.ts's rampart anchors: spawn, towers, storage, links) - unlike every other
  // site type, its tile is never free ground, it's already occupied by a destructible
  // structure. findClosestByPath/moveTo default to range: 0 ("path to the tile the target
  // is on"), and a destructible structure blocks pathing by default (see
  // ignoreDestructibleStructures) - so a rampart's own tile is unreachable at range 0,
  // and findClosestByPath silently excludes it (returns null) rather than picking it.
  // Found live: W57N24's spawn-tile rampart (see TOWER_PRIORITY_OVERRIDE - built
  // specifically to get ahead of a repeat attack) sat at 0/1 progress for hours while
  // builders, unable to ever select it at all, kept finishing extensions instead. range:
  // 1 only requires getting adjacent, which is all build()'s own range-3 requirement ever
  // needed anyway - same fix REMOTE_MOVE_OPTS already applies for the equivalent
  // cross-room waypoint problem.
  //
  // Towers and ramparts are checked as two separate, ordered groups rather than one
  // combined pool - a tower is the only thing that actually stops a fight in progress
  // (a rampart just delays it), so it must win over a same-tick rampart site regardless
  // of which happens to be closer. Once a room's tower is up (or hasn't unlocked yet),
  // this collapses back to "whichever rampart is closest", same as before.
  const towerSites = sites.filter((candidate) => candidate.structureType === STRUCTURE_TOWER);
  const rampartSites = sites.filter((candidate) => candidate.structureType === STRUCTURE_RAMPART);
  const site =
    creep.pos.findClosestByPath(containerSites) ??
    creep.pos.findClosestByPath(towerSites, { range: 1 }) ??
    creep.pos.findClosestByPath(rampartSites, { range: 1 }) ??
    creep.pos.findClosestByPath(sites);
  if (site) {
    const moveOpts =
      site.structureType === STRUCTURE_RAMPART || site.structureType === STRUCTURE_TOWER
        ? { ...MOVE_OPTS, range: 1 }
        : MOVE_OPTS;
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, moveOpts);
    }
    return;
  }

  if (!creep.room.controller) return;

  if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(creep.room.controller, MOVE_OPTS);
  }
}
