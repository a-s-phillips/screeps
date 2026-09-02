import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import { decideWorkingState, deliverEnergy, MOVE_OPTS, travelToRoom } from "./shared";

const SOURCE_KEEPER_USERNAME = "Source Keeper";
// Both constants are unverified starting guesses - tune from live observation (see
// project notes on the SK-avoidance deploy sequence). KEEPER_RETREAT_LEAD_TICKS needs
// to cover the Keeper's own walk from lair to source plus this creep's walk back to
// safety, not just a flat margin against the spawn instant.
const KEEPER_RETREAT_RADIUS = 5;
const KEEPER_RETREAT_LEAD_TICKS = 100;

function hasRealHostile(room: Room): boolean {
  return getCachedFind(room, FIND_HOSTILE_CREEPS).some(
    (creep) => creep.owner.username !== SOURCE_KEEPER_USERNAME
  );
}

function nearestLiveKeeper(room: Room, pos: RoomPosition): Creep | undefined {
  const keepers = getCachedFind(room, FIND_HOSTILE_CREEPS).filter(
    (creep) => creep.owner.username === SOURCE_KEEPER_USERNAME
  );
  if (keepers.length === 0) return undefined;

  return keepers.reduce((nearest, candidate) =>
    chebyshevDistance(pos, candidate.pos) < chebyshevDistance(pos, nearest.pos) ? candidate : nearest
  );
}

// Reactive safety check - wins regardless of what any lair's ticksToSpawn predicts.
// Keepers patrol and hunt within a leash radius around their guarded object, not just
// the literal source tile, so this can't be replaced by the predictive check alone.
function isKeeperNearby(room: Room, pos: RoomPosition): boolean {
  const keeper = nearestLiveKeeper(room, pos);
  return keeper !== undefined && chebyshevDistance(pos, keeper.pos) <= KEEPER_RETREAT_RADIUS;
}

function nearestLair(room: Room, pos: RoomPosition): StructureKeeperLair | undefined {
  const lairs = getCachedFind(room, FIND_HOSTILE_STRUCTURES).filter(
    (structure): structure is StructureKeeperLair => structure.structureType === STRUCTURE_KEEPER_LAIR
  );
  if (lairs.length === 0) return undefined;

  return lairs.reduce((nearest, candidate) =>
    chebyshevDistance(pos, candidate.pos) < chebyshevDistance(pos, nearest.pos) ? candidate : nearest
  );
}

// Predictive targeting, not a safety gate on its own - used only to pick which source is
// worth approaching this cycle. Undefined ticksToSpawn means a Keeper is currently alive
// and guarding; a low-but-defined countdown means one is about to spawn.
function isSourceSafe(room: Room, source: Source): boolean {
  const lair = nearestLair(room, source.pos);
  if (!lair) return true;

  return lair.ticksToSpawn !== undefined && lair.ticksToSpawn > KEEPER_RETREAT_LEAD_TICKS;
}

// Filters to safe sources first, then picks nearest-by-path among those - picking
// nearest-then-checking-safety would throw away two good sources whenever the nearest
// one happens to be guarded right now.
function nearestSafeSource(creep: Creep): Source | undefined {
  const sources = getCachedFind(creep.room, FIND_SOURCES_ACTIVE);
  const safe = sources.filter((source) => isSourceSafe(creep.room, source));
  return creep.pos.findClosestByPath(safe) ?? undefined;
}

export function run(creep: Creep): void {
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  const working = decideWorkingState(creep.memory.working, isEmpty, isFull);
  creep.memory.working = working;

  if (!working) {
    const remoteRoom = creep.memory.remoteRoom;
    if (!remoteRoom) return;

    if (!travelToRoom(creep, remoteRoom)) return;

    // Nothing safe right now, whether from an active threat or every source being
    // predictively unsafe - head toward home rather than idling exposed. Simple v1
    // choice; may be worth a "wait at a safe spot" refinement later.
    if (hasRealHostile(creep.room) || isKeeperNearby(creep.room, creep.pos)) {
      if (creep.memory.homeRoom) travelToRoom(creep, creep.memory.homeRoom);
      return;
    }

    const source = nearestSafeSource(creep);
    if (!source) {
      if (creep.memory.homeRoom) travelToRoom(creep, creep.memory.homeRoom);
      return;
    }

    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, MOVE_OPTS);
    }
    return;
  }

  const homeRoom = creep.memory.homeRoom;
  if (!homeRoom || !travelToRoom(creep, homeRoom)) return;

  deliverEnergy(creep);
}
