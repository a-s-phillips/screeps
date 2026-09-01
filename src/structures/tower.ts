import { getCachedFind } from "../utils/roomCache";

// Ramparts/walls have enormous hitsMax (up to 300M) - repairing them to full would
// sink a tower's entire energy output forever. Cap how far towers bother repairing
// them so energy stays available for creeps/structures that can actually reach full health.
const RAMPART_WALL_REPAIR_CAP = 10000;

// Keep at least half the tower's energy in reserve before spending it on repairs, so a
// tower that just topped off doesn't get caught empty-handed if a hostile shows up next tick.
const REPAIR_ENERGY_RESERVE_RATIO = 0.5;

export function run(tower: StructureTower): void {
  const hostiles = getCachedFind(tower.room, FIND_HOSTILE_CREEPS);
  const hostileTarget = tower.pos.findClosestByRange(hostiles);
  if (hostileTarget) {
    tower.attack(hostileTarget);
    return;
  }

  const damagedCreeps = getCachedFind(tower.room, FIND_MY_CREEPS).filter(
    (creep) => creep.hits < creep.hitsMax
  );
  const creepTarget = tower.pos.findClosestByRange(damagedCreeps);
  if (creepTarget) {
    tower.heal(creepTarget);
    return;
  }

  const capacity = tower.store.getCapacity(RESOURCE_ENERGY) ?? 0;
  const energy = tower.store.getUsedCapacity(RESOURCE_ENERGY);
  if (capacity === 0 || energy < capacity * REPAIR_ENERGY_RESERVE_RATIO) return;

  const repairTarget = findWeakestRepairTarget(tower);
  if (repairTarget) tower.repair(repairTarget);
}

function needsRepair(structure: AnyStructure): boolean {
  if (structure.structureType === STRUCTURE_WALL || structure.structureType === STRUCTURE_RAMPART) {
    return structure.hits < RAMPART_WALL_REPAIR_CAP;
  }
  return structure.hits < structure.hitsMax;
}

function findWeakestRepairTarget(tower: StructureTower): AnyStructure | undefined {
  const repairable = getCachedFind(tower.room, FIND_STRUCTURES).filter(needsRepair);
  if (repairable.length === 0) return undefined;

  return repairable.reduce((weakest, candidate) => {
    if (candidate.hits < weakest.hits) return candidate;
    if (candidate.hits > weakest.hits) return weakest;
    return tower.pos.getRangeTo(candidate) < tower.pos.getRangeTo(weakest) ? candidate : weakest;
  });
}
