import { getCachedFind } from "../utils/roomCache";
import {
  decideWorkingState,
  findAdjacentActiveSource,
  harvestFromNearestSource,
  MOVE_OPTS,
  withdrawFromFullestContainer
} from "./shared";

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    // An active source right next to the creep (e.g. building that source's own
    // container) is zero-travel and otherwise-uncollected income - worth harvesting
    // directly even if some other container elsewhere has more energy sitting in it.
    const adjacentSource = findAdjacentActiveSource(creep);
    if (adjacentSource) {
      creep.harvest(adjacentSource);
      return;
    }

    if (withdrawFromFullestContainer(creep)) return;
    harvestFromNearestSource(creep);
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
  const site = creep.pos.findClosestByPath(containerSites) ?? creep.pos.findClosestByPath(sites);
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
