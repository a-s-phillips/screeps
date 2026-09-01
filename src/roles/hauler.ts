import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import { decideWorkingState, deliverEnergy, MOVE_OPTS, withdrawFromNearestContainer } from "./shared";

function findControllerContainer(room: Room): StructureContainer | undefined {
  if (!room.controller) return undefined;
  const controllerPos = room.controller.pos;

  return getCachedFind(room, FIND_STRUCTURES).find(
    (structure): structure is StructureContainer =>
      structure.structureType === STRUCTURE_CONTAINER &&
      chebyshevDistance(structure.pos, controllerPos) <= 1
  );
}

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    withdrawFromNearestContainer(creep);
    return;
  }

  if (deliverEnergy(creep)) return;

  const controllerContainer = findControllerContainer(creep.room);
  if (controllerContainer && controllerContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(controllerContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(controllerContainer, MOVE_OPTS);
    }
    return;
  }

  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller, MOVE_OPTS);
    }
  }
}
