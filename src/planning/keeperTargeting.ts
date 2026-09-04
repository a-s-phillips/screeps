import { getCachedFind } from "../utils/roomCache";

// Both unverified starting guesses - tune from live observation (see project notes on
// the SK-avoidance deploy sequence). KEEPER_RETREAT_LEAD_TICKS needs to cover the
// Keeper's own walk from lair to source plus a creep's walk back to safety, not just a
// flat margin against the spawn instant. Shared between keeperHarvester.ts's live
// reactive/predictive safety checks and decideKeeperSpawn's spawn-timing gate below -
// keeping both here means the two can't drift apart on what "enough runway" means.
export const KEEPER_RETREAT_RADIUS = 5;
export const KEEPER_RETREAT_LEAD_TICKS = 100;

// Slightly more than one full observed guard+open cycle (~200 open / ~1,600 guarded, see
// project notes) - once intel is older than this, a "window closed"/"fully guarded"
// reading is no longer trustworthy, since a whole new window could have opened and
// closed again with nobody there to see it.
export const KEEPER_INTEL_STALE_AFTER = 2000;

// Overwritten every tick while visible (called from main.ts for every room the bot
// currently has vision into, same as recordRemoteIntel) - stays frozen at its last
// observed value once vision is lost, since nothing else can refresh it in the meantime.
export function recordKeeperIntel(room: Room, memory: RoomMemory): void {
  const lairs = getCachedFind(room, FIND_HOSTILE_STRUCTURES).filter(
    (structure): structure is StructureKeeperLair =>
      structure.structureType === STRUCTURE_KEEPER_LAIR
  );
  if (lairs.length === 0) return;

  const openCountdowns = lairs
    .map((lair) => lair.ticksToSpawn)
    .filter((ticksToSpawn): ticksToSpawn is number => ticksToSpawn !== undefined);

  memory.keeperIntel = {
    nextWindowCloseTick: openCountdowns.length > 0 ? Game.time + Math.min(...openCountdowns) : null,
    observedAt: Game.time
  };
}

// No intel at all means the room has never been scouted - let one spawn through blind to
// go establish vision, the same "accept the sunk cost once" tradeoff the original manual
// deploy made. Once real intel exists, spawning blind into a room known to be fully
// guarded (or whose only known window will already be closed, with KEEPER_RETREAT_LEAD_TICKS
// margin, by the time the creep could arrive) reproduces exactly the bug this gate exists
// to fix - found live: three spawns in a row landed mid-guarded-phase and died of old age
// without ever harvesting, because nothing checked timing at all before this.
//
// Stale intel gets the same "no intel" bypass, not just fresh intel's absence - without
// it, a "guarded"/"window closed" reading that's never refreshed (because nothing ever
// spawns to re-observe it) stalls the room forever: no keeperHarvester ever goes back to
// call recordKeeperIntel again. Found live: W56N25 sat 23,000+ ticks stale, many full
// guard/open cycles, with the colony never noticing the room had opened again.
export function isKeeperWindowReachable(
  intel: KeeperIntel | undefined,
  now: number,
  arrivalOffset: number
): boolean {
  if (!intel || now - intel.observedAt > KEEPER_INTEL_STALE_AFTER) return true;
  if (intel.nextWindowCloseTick === null) return false;
  return now + arrivalOffset + KEEPER_RETREAT_LEAD_TICKS <= intel.nextWindowCloseTick;
}
