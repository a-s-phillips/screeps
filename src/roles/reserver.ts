import { MOVE_OPTS, retreatFromHostileRemote, travelToRoom } from "./shared";

export function run(creep: Creep): void {
  const remoteRoom = creep.memory.remoteRoom;
  if (!remoteRoom) return;

  if (retreatFromHostileRemote(creep, remoteRoom, creep.memory.homeRoom)) return;

  if (!travelToRoom(creep, remoteRoom)) return;

  const controller = creep.room.controller;
  if (!controller) return;

  if (creep.reserveController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, MOVE_OPTS);
  }
}
