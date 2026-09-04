import {
  decideWorkingState,
  deliverEnergy,
  findControllerContainer,
  MOVE_OPTS,
  withdrawFromFullestContainer
} from "./shared";

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    // The controller container is a delivery target for haulers, not a pickup source -
    // withdrawing from it here would just recirculate energy in place (drain it right
    // back out) instead of relaying fresh energy in from the source-side containers,
    // starving upgraders of the container's whole point. Found live: haulers were
    // parking next to it and cycling withdraw/deposit while source containers sat
    // nearly full, undrained, on the other side of the room.
    withdrawFromFullestContainer(creep, findControllerContainer(creep.room));
    return;
  }

  // deliverEnergy now includes the controller container in its own closest-need-wins
  // pool alongside spawn/extension/tower, so no separate fallback branch is needed here.
  if (deliverEnergy(creep)) return;

  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller, MOVE_OPTS);
    }
  }
}
