import { getMyUsername } from "../planning/remoteTargeting";
import { MOVE_OPTS, retreatFromHostileRemote, travelToRoom } from "./shared";

export function run(creep: Creep): void {
  const remoteRoom = creep.memory.remoteRoom;
  if (!remoteRoom) return;

  if (retreatFromHostileRemote(creep, remoteRoom, creep.memory.homeRoom)) return;

  if (!travelToRoom(creep, remoteRoom)) return;

  const controller = creep.room.controller;
  if (!controller) return;

  // reserveController silently refuses (ERR_INVALID_TARGET, no intent even sent) against
  // a controller someone else already holds - attackController is the only action that
  // moves a hostile-held reservation's endTime at all, ticking it down 1 per CLAIM part
  // per tick until it hits 0 and clears to neutral, at which point reserveController
  // starts working again on its own next tick.
  const reservedByOther =
    controller.reservation !== undefined && controller.reservation.username !== getMyUsername();
  const result = reservedByOther
    ? creep.attackController(controller)
    : creep.reserveController(controller);

  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, MOVE_OPTS);
  }
}
