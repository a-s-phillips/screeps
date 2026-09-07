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

  const spawn = getCachedFind(creep.room, FIND_MY_SPAWNS)[0];
  if (spawn) creep.moveTo(spawn, MOVE_OPTS);
}
