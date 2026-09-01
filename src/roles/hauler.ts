import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import {
  decideWorkingState,
  deliverEnergy,
  MOVE_OPTS,
  withdrawFromFullestContainer
} from "./shared";

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

  const controllerContainer = findControllerContainer(creep.room);

  if (!working) {
    // The controller container is a delivery target for haulers, not a pickup source -
    // withdrawing from it here would just recirculate energy in place (drain it right
    // back out) instead of relaying fresh energy in from the source-side containers,
    // starving upgraders of the container's whole point. Found live: haulers were
    // parking next to it and cycling withdraw/deposit while source containers sat
    // nearly full, undrained, on the other side of the room.
    withdrawFromFullestContainer(creep, controllerContainer);
    return;
  }

  if (deliverEnergy(creep)) return;

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
