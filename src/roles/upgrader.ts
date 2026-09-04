import { decideWorkingState, findControllerContainer, gatherEnergy, MOVE_OPTS } from "./shared";

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    // An upgrader is stationary at the controller (unlike builder, gatherEnergy's other
    // caller, which moves around), so its own adjacent container should always win over
    // gatherEnergy's "nearest source vs. globally fullest container" comparison - that
    // comparison picks whichever container has the most energy anywhere in the room,
    // not whichever is nearest, so it could send a controller-stationed upgrader on a
    // long walk past its own partially-full container to a fuller one elsewhere. Only
    // fall through to the general logic once the local container is actually empty.
    const controllerContainer = findControllerContainer(creep.room);
    if (controllerContainer && controllerContainer.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      if (creep.withdraw(controllerContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controllerContainer, MOVE_OPTS);
      }
      return;
    }

    gatherEnergy(creep);
    return;
  }

  if (!creep.room.controller) return;

  if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(creep.room.controller, MOVE_OPTS);
  }
}
