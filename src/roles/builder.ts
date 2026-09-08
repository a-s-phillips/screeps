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
  // Same "closest site alone can't guarantee this gets built" problem containers have,
  // just for a different reason: a rampart/tower can cost as little as 1 build point, so
  // once a builder happens to be sitting closer to some other in-progress site it can
  // lose that distance race forever, no matter how cheap or urgent it is. Found live:
  // W57N24's spawn-tile rampart (see TOWER_PRIORITY_OVERRIDE - built specifically to get
  // ahead of a repeat attack) sat at 0/1 progress for hours while builders kept finishing
  // extensions instead.
  const defenseSites = sites.filter(
    (candidate) =>
      candidate.structureType === STRUCTURE_RAMPART || candidate.structureType === STRUCTURE_TOWER
  );
  const site =
    creep.pos.findClosestByPath(containerSites) ??
    creep.pos.findClosestByPath(defenseSites) ??
    creep.pos.findClosestByPath(sites);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, MOVE_OPTS);
    }
    return;
  }

  if (!creep.room.controller) return;

  if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(creep.room.controller, MOVE_OPTS);
  }
}
