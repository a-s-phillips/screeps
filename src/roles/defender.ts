import { getCachedFind } from "../utils/roomCache";
import { MOVE_OPTS } from "./shared";

// Home-room-only: no cross-room travel logic at all. Remote-mining creeps get
// recall-only (see retreatFromHostileRemote in shared.ts) - a defender never leaves
// its home room to fight, and never will under this design.
export function run(creep: Creep): void {
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
