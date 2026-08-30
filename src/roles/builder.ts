import { getCachedFind } from "../utils/roomCache";
import { decideWorkingState, harvestFromNearestSource, MOVE_OPTS } from "./shared";

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    harvestFromNearestSource(creep);
    return;
  }

  const sites = getCachedFind(creep.room, FIND_CONSTRUCTION_SITES);
  const site = creep.pos.findClosestByPath(sites);
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
