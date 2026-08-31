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
