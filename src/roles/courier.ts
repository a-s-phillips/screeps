import { deliverEnergy, decideWorkingState, retreatFromHostileRemote, travelToRoom, MOVE_OPTS } from "./shared";

// The mirror image of remoteHauler: travels to its home room (the donor) to load up from
// storage specifically - never a source-side container, which belongs to that room's own
// miner/hauler pipeline - then travels to remoteRoom (the sibling room it's supporting)
// and delivers through the normal closest-need-wins pool (deliverEnergy).
export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    const homeRoom = creep.memory.homeRoom;
    if (!homeRoom || !travelToRoom(creep, homeRoom)) return;

    const storage = creep.room.storage;
    if (!storage || storage.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return;

    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, MOVE_OPTS);
    }
    return;
  }

  const remoteRoom = creep.memory.remoteRoom;
  if (!remoteRoom) return;

  if (retreatFromHostileRemote(creep, remoteRoom, creep.memory.homeRoom)) return;
  if (!travelToRoom(creep, remoteRoom)) return;

  deliverEnergy(creep);
}
