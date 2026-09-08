import { getCachedFind } from "../utils/roomCache";
import {
  decideWorkingState,
  gatherEnergy,
  MOVE_OPTS,
  retreatFromHostileRemote,
  travelToRoom
} from "./shared";

// Comfortably above the ~91-tick one-way travel time to a fresh claim's controller (see
// remoteSpawnManager.ts's RESERVER_TRAVEL_ESTIMATE) - a big multiple of that margin, so
// this only ever needs to catch a real near-miss, not race one. Failsafe for the case
// nobody's watching a colonize push live and spawn-build duty (see the priority block
// below) runs long enough to threaten the controller's real downgrade timer
// (CONTROLLER_DOWNGRADE[1] = 20,000 ticks) - see the 2026-09-08 state-of-play note.
const DOWNGRADE_FAILSAFE_THRESHOLD = 5000;

export function run(creep: Creep): void {
  const remoteRoom = creep.memory.remoteRoom;
  if (!remoteRoom) return;

  if (retreatFromHostileRemote(creep, remoteRoom, creep.memory.homeRoom)) return;

  if (!travelToRoom(creep, remoteRoom)) return;

  const controller = creep.room.controller;
  // Any upgradeController call resets ticksToDowngrade to the full CONTROLLER_DOWNGRADE
  // value no matter how little energy it delivers, so a single nudge is enough - takes
  // priority over spawn-build/gathering whenever it's live, since losing the claim
  // outright is worse than a delayed spawn. Gated on whatever energy the creep is
  // currently carrying (not "full") - waiting for a full load isn't worth the risk here.
  if (
    controller?.my &&
    typeof controller.ticksToDowngrade === "number" &&
    controller.ticksToDowngrade < DOWNGRADE_FAILSAFE_THRESHOLD &&
    creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  ) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, MOVE_OPTS);
    }
    return;
  }

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

  // .my, not just existence - a pre-positioned colonizer (see remoteSpawnManager.ts's
  // decideColonizerSpawn) can arrive before the claim actually lands, and
  // upgradeController on a controller we don't own yet would just error every tick.
  // Idling fully-loaded until planSpawn places a site (or the claim lands) is correct.
  if (!creep.room.controller?.my) return;

  if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(creep.room.controller, MOVE_OPTS);
  }
}
