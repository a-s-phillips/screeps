export interface HostileSighting {
  owner: string;
  room: string;
  hasAttack: boolean;
  hasRanged: boolean;
  hasHeal: boolean;
}

export interface HostileDetectionResult {
  sightings: HostileSighting[];
  seenIds: Set<string>;
}

export function detectNewHostiles(
  hostiles: Creep[],
  previouslySeenIds: Set<string>
): HostileDetectionResult {
  const seenIds = new Set(previouslySeenIds);
  const sightings: HostileSighting[] = [];

  for (const hostile of hostiles) {
    if (seenIds.has(hostile.id)) continue;

    seenIds.add(hostile.id);
    const parts = new Set(hostile.body.map((part) => part.type));
    sightings.push({
      owner: hostile.owner.username,
      room: hostile.room.name,
      hasAttack: parts.has(ATTACK),
      hasRanged: parts.has(RANGED_ATTACK),
      hasHeal: parts.has(HEAL)
    });
  }

  return { sightings, seenIds };
}

// A remote room has no towers/ramparts, so an unarmed foreign creep (a reserver
// squatting on the controller, a scout passing through) poses no actual threat there -
// only ATTACK/RANGED_ATTACK parts mean a creep can hurt something. Distinguishing this
// matters because a reserver's presence is often permanent: counting it as "hostile"
// would keep isRoomHostile() true forever and permanently evict our own remote creeps
// from a room that's merely reserved, not actually dangerous.
function isThreatening(creep: Creep): boolean {
  return creep.body.some((part) => part.type === ATTACK || part.type === RANGED_ATTACK);
}

export function recordHostileSighting(memory: RoomMemory, hostiles: Creep[]): void {
  if (hostiles.some(isThreatening)) {
    memory.lastHostileSeenTick = Game.time;
  }
}
