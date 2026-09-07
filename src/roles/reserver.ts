import { getMyUsername } from "../planning/remoteTargeting";
import { MOVE_OPTS, retreatFromHostileRemote, travelToRoom } from "./shared";

// Mirrors claimController's own precondition (GCL must allow one more owned room than we
// currently have) - checked here so a reserver assigned as a claim target only ever
// attempts claimController on a tick it can actually succeed, and falls back to its
// normal reserveController maintenance the rest of the time. Getting this wrong in
// either direction is costly: attempting too early wastes a tick that should have kept
// the reservation alive (see the claim-target branch below), and never attempting means
// GCL2 landing does nothing on its own.
function hasGclHeadroomForAnotherRoom(): boolean {
  const ownedRoomCount = Object.values(Game.rooms).filter((room) => room.controller?.my).length;
  return Game.gcl.level > ownedRoomCount;
}

export function run(creep: Creep): void {
  const remoteRoom = creep.memory.remoteRoom;
  if (!remoteRoom) return;

  if (retreatFromHostileRemote(creep, remoteRoom, creep.memory.homeRoom)) return;

  if (!travelToRoom(creep, remoteRoom)) return;

  const controller = creep.room.controller;
  if (!controller) return;
  if (controller.my) return;

  // A remote room can be designated a claim target (RoomMemory.claimTarget, manually set
  // - see memory.d.ts) once a second-room plan is ready to execute. Reusing this same
  // reserver instead of a dedicated claimer role/spawn path is deliberate: it already has
  // the right body (a reserver's CLAIM+MOVE is identical to what claiming needs) and is
  // already standing at the controller, maintaining the reservation that keeps a rival
  // from taking the room in the meantime - spawning and traveling a fresh claimer from
  // scratch would reopen exactly that window. Falls through to normal reserve/attack
  // behavior below until GCL genuinely allows claiming, so the reservation never lapses
  // while waiting on GCL to catch up.
  const homeMemory = creep.memory.homeRoom ? Memory.rooms[creep.memory.homeRoom] : undefined;
  if (homeMemory?.claimTarget === remoteRoom && hasGclHeadroomForAnotherRoom()) {
    const result = creep.claimController(controller);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, MOVE_OPTS);
    }
    return;
  }

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
