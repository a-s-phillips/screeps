import { getCachedFind } from "../utils/roomCache";
import { MOVE_OPTS, travelToRoom } from "./shared";

// Deliberately reverses an earlier "never leaves its home room to fight" design -
// protecting a claim in progress (see remoteSpawnManager.ts's decideRemoteDefenderSpawn)
// needs a creep willing to actually engage a rival's CLAIM-carrying creep, not retreat
// from it the way every other remote role does (see shared.ts's
// retreatFromHostileRemote, deliberately not used here). A local defender (no
// memory.remoteRoom) behaves exactly as before - this only adds a travel leg when one is
// assigned.
export function run(creep: Creep): void {
  const remoteRoom = creep.memory.remoteRoom;
  if (remoteRoom && !travelToRoom(creep, remoteRoom)) return;

  const hostiles = getCachedFind(creep.room, FIND_HOSTILE_CREEPS);
  const target = creep.pos.findClosestByRange(hostiles);

  if (target) {
    if (creep.attack(target) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, MOVE_OPTS);
    }
    return;
  }

  // Falls back to the controller, not just idling, once there's neither a hostile nor a
  // spawn to head for - found live: a creep that comes to rest exactly on the border
  // row/column it crossed on (travelToRoom's arrival point, before it's taken any further
  // step inward) can get reverted by the engine to the room it came from, even with zero
  // move intent issued. Every other remote role already has a real fallback destination
  // once its main job is done (colonizer/reserver both gravitate to the controller too),
  // which incidentally walks it off the exact border tile - defender was the one role
  // with a genuine "do nothing" fallback, and paid for it with an unbounded per-tick
  // ping-pong across the border.
  const anchor = getCachedFind(creep.room, FIND_MY_SPAWNS)[0] ?? creep.room.controller;
  if (anchor) creep.moveTo(anchor, MOVE_OPTS);
}
