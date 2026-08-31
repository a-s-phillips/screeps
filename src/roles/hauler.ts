import { getCachedFind } from "../utils/roomCache";
import { decideWorkingState, deliverEnergy, MOVE_OPTS } from "./shared";

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    const containers = getCachedFind(creep.room, FIND_STRUCTURES).filter(
      (structure): structure is StructureContainer =>
        structure.structureType === STRUCTURE_CONTAINER &&
        structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    );
    const target = creep.pos.findClosestByPath(containers);
    if (!target) return;

    if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, MOVE_OPTS);
    }
    return;
  }

  if (deliverEnergy(creep)) return;

  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller, MOVE_OPTS);
    }
  }
}
