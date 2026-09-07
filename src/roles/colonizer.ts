import { getCachedFind } from "../utils/roomCache";
import {
  decideWorkingState,
  gatherEnergy,
  MOVE_OPTS,
  retreatFromHostileRemote,
  travelToRoom
} from "./shared";

export function run(creep: Creep): void {
  const remoteRoom = creep.memory.remoteRoom;
  if (!remoteRoom) return;

  if (retreatFromHostileRemote(creep, remoteRoom, creep.memory.homeRoom)) return;

  if (!travelToRoom(creep, remoteRoom)) return;

  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    gatherEnergy(creep);
    return;
  }

  const sites = getCachedFind(creep.room, FIND_CONSTRUCTION_SITES);
  // The spawn site is the entire reason this creep was sent - every other planner in
  // roomPlanner.ts is spawn-anchored and silently no-ops without one (see planSpawn), so
  // it always wins over any other site type, same as builder.ts prioritizing containers.
  const spawnSites = sites.filter((candidate) => candidate.structureType === STRUCTURE_SPAWN);
  const site = creep.pos.findClosestByPath(spawnSites) ?? creep.pos.findClosestByPath(sites);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, MOVE_OPTS);
    }
    return;
  }

  if (!creep.room.controller) return;

  if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(creep.room.controller, MOVE_OPTS);
  }
}
