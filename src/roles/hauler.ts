import {
  collectFullestEnergy,
  decideWorkingState,
  deliverEnergy,
  findControllerContainer,
  MOVE_OPTS,
  travelToRoom
} from "./shared";

export function run(creep: Creep): void {
  // A hauler's whole logic below assumes creep.room is home - none of it (unlike
  // remoteHauler/reserver/etc) has a homeRoom-aware fallback of its own. Without this,
  // a hauler that ever ends up outside its room for any reason (e.g. chasing dropped
  // energy near a shared border) has no way back and is stranded there until it dies,
  // silently doing nothing useful and no longer counting toward its room's hauler
  // target - found live on the official server.
  const homeRoom = creep.memory.homeRoom;
  if (homeRoom && creep.room.name !== homeRoom) {
    travelToRoom(creep, homeRoom);
    return;
  }

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
    collectFullestEnergy(creep, findControllerContainer(creep.room));
    return;
  }

  // deliverEnergy now includes the controller container in its own closest-need-wins
  // pool alongside spawn/extension/tower, so no separate fallback branch is needed here.
  if (deliverEnergy(creep).attempted) return;

  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller, MOVE_OPTS);
    }
  }
}
