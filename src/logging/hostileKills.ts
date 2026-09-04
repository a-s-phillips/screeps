export interface HostileKill {
  owner: string;
  room: string;
}

export interface HostileKillDetectionResult {
  kills: HostileKill[];
  seenIds: Set<string>;
}

// Tombstones persist for many ticks after death (until they decay), so without
// dedup the same kill would get re-reported on every tick the tombstone stays
// visible. Mirrors detectNewHostiles' seenIds pattern - same shape, same tradeoff
// (module-level Set in main.ts, lost on a global reset, and re-detected as "new"
// if a tombstone is still visible then).
export function detectHostileKills(
  tombstones: Tombstone[],
  previouslySeenIds: Set<string>
): HostileKillDetectionResult {
  const seenIds = new Set(previouslySeenIds);
  const kills: HostileKill[] = [];

  for (const tombstone of tombstones) {
    if (seenIds.has(tombstone.id)) continue;

    seenIds.add(tombstone.id);
    if (tombstone.creep.my || !tombstone.room) continue;

    kills.push({ owner: tombstone.creep.owner.username, room: tombstone.room.name });
  }

  return { kills, seenIds };
}
