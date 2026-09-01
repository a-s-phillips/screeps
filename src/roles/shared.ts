import { chebyshevDistance } from "../utils/grid";
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

export function deliverEnergy(creep: Creep): boolean {
  const targets = getCachedFind(creep.room, FIND_MY_STRUCTURES).filter(
    (structure): structure is StructureSpawn | StructureExtension =>
      (structure.structureType === STRUCTURE_SPAWN ||
        structure.structureType === STRUCTURE_EXTENSION) &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  const target = creep.pos.findClosestByPath(targets);
  if (!target) return false;

  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, MOVE_OPTS);
  }
  return true;
}

// Prefers whichever container has the biggest energy backlog over whichever is merely
// closest, tie-broken by distance. Pure "nearest" lets creeps permanently converge on
// one container while another sits full and overflows - found live: a source's
// container hit capacity and stayed there, spilling 4600+ energy onto the ground and
// decaying, because every hauler kept re-picking the other (nearer, to them) container
// instead of ever checking back on it.
export function withdrawFromFullestContainer(creep: Creep, exclude?: StructureContainer): boolean {
  const containers = getCachedFind(creep.room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.id !== exclude?.id &&
      structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  );
  if (containers.length === 0) return false;

  const target = containers.reduce((biggest, candidate) => {
    const biggestEnergy = biggest.store.getUsedCapacity(RESOURCE_ENERGY);
    const candidateEnergy = candidate.store.getUsedCapacity(RESOURCE_ENERGY);
    if (candidateEnergy > biggestEnergy) return candidate;
    if (candidateEnergy < biggestEnergy) return biggest;
    return chebyshevDistance(creep.pos, candidate.pos) < chebyshevDistance(creep.pos, biggest.pos)
      ? candidate
      : biggest;
  });

  if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, MOVE_OPTS);
  }
  return true;
}

export function findAdjacentContainerWithCapacity(creep: Creep): StructureContainer | undefined {
  const containers = getCachedFind(creep.room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  return containers.find((container) => chebyshevDistance(creep.pos, container.pos) <= 1);
}

export function findContainerAtSource(source: Source): StructureContainer | undefined {
  const containers = getCachedFind(source.room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER
  );
  return containers.find((container) => chebyshevDistance(source.pos, container.pos) <= 1);
}
