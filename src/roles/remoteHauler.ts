import {
  decideWorkingState,
  deliverEnergy,
  retreatFromHostileRemote,
  travelToRoom,
  withdrawFromFullestContainer
} from "./shared";

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    const remoteRoom = creep.memory.remoteRoom;
    if (!remoteRoom) return;

    if (retreatFromHostileRemote(creep, remoteRoom, creep.memory.homeRoom)) return;

    if (!travelToRoom(creep, remoteRoom)) return;

    withdrawFromFullestContainer(creep);
    return;
  }

  const homeRoom = creep.memory.homeRoom;
  if (!homeRoom || !travelToRoom(creep, homeRoom)) return;

  deliverEnergy(creep);
}
