import { getCachedFind } from "../utils/roomCache";

export const MOVE_OPTS: MoveToOpts = { reusePath: 5 };

export function decideWorkingState(
  currentlyWorking: boolean,
  isEmpty: boolean,
  isFull: boolean
): boolean {
  if (currentlyWorking && isEmpty) return false;
  if (!currentlyWorking && isFull) return true;
  return currentlyWorking;
}

export function harvestFromNearestSource(creep: Creep): void {
  const sources = getCachedFind(creep.room, FIND_SOURCES_ACTIVE);
  const target = creep.pos.findClosestByPath(sources);
  if (!target) return;

  if (creep.harvest(target) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, MOVE_OPTS);
  }
}
