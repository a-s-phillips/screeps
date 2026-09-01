// A creep needs roughly (bodyLength * CREEP_SPAWN_TIME) ticks to finish spawning, plus
// however long it takes to walk from the spawn to wherever it's actually needed, before
// it's doing useful work. Treating a creep as "already gone" once its remaining lifetime
// drops below that lead time lets the spawner queue its replacement early, instead of
// only reacting once the room is actually down a creep.
export function replacementLeadTime(bodyLength: number, travelDistance: number): number {
  return bodyLength * CREEP_SPAWN_TIME + travelDistance;
}

// ticksToLive is undefined while a creep is still spawning (or hasn't been read yet) -
// treat that as healthy rather than near death, since it can't need a replacement queued
// before it even exists.
export function isNearingDeath(ticksToLive: number | undefined, leadTime: number): boolean {
  return ticksToLive !== undefined && ticksToLive <= leadTime;
}
