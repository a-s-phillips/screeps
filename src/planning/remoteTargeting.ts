import { getCachedFind } from "../utils/roomCache";

// A remote room has no towers/ramparts to fall back on (can't build them without owning
// the room), so this same recency window gates both new remote spawns
// (remoteSpawnManager) and recalling creeps already out there (roles/shared.ts) - kept
// here as the single source of truth so the two can't drift apart on what "still
// dangerous" means.
export const REMOTE_HOSTILE_MEMORY_WINDOW = 200;

export function isRoomHostile(lastHostileSeenTick: number | undefined, now: number): boolean {
  return (
    lastHostileSeenTick !== undefined && now - lastHostileSeenTick <= REMOTE_HOSTILE_MEMORY_WINDOW
  );
}

// Static map exit topology - no vision required, works for a room the bot has never seen.
export function getRemoteCandidates(homeRoomName: string): string[] {
  const exits = Game.map.describeExits(homeRoomName);
  return exits ? Object.values(exits) : [];
}

// Not ready to decide until every candidate has recorded intel - a candidate the bot
// hasn't scouted yet must not be silently treated as unviable (undefined !== excluded).
export function pickBestCandidate(
  candidates: string[],
  intelByRoom: Record<string, RemoteIntel | undefined>
): string | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.some((candidate) => intelByRoom[candidate] === undefined)) return undefined;

  const viable = candidates.filter((candidate) => {
    const intel = intelByRoom[candidate]!;
    return (
      !intel.ownedByOther &&
      !intel.reservedByOther &&
      !intel.hasSourceKeeper &&
      intel.sourceCount > 0
    );
  });
  if (viable.length === 0) return undefined;

  return viable.reduce((best, candidate) =>
    intelByRoom[candidate]!.sourceCount > intelByRoom[best]!.sourceCount ? candidate : best
  );
}

// A one-time, sticky decision per home room: once a remote room is chosen, it's never
// re-evaluated in v1 (no story yet for "the choice turned out worse than expected").
export function resolveRemoteRoom(
  homeRoomName: string,
  homeMemory: RoomMemory,
  candidateMemories: Record<string, RoomMemory | undefined>
): string | undefined {
  if (homeMemory.remoteRoom) return homeMemory.remoteRoom;

  const candidates = getRemoteCandidates(homeRoomName);
  const intelByRoom: Record<string, RemoteIntel | undefined> = {};
  for (const candidate of candidates) {
    intelByRoom[candidate] = candidateMemories[candidate]?.remoteIntel;
  }

  const best = pickBestCandidate(candidates, intelByRoom);
  if (best) homeMemory.remoteRoom = best;
  return best;
}

// Overwritten every tick while visible, so it can't go stale while a scout/reserver/
// remoteHarvester is present - called for every room the bot currently has vision into,
// not just chosen remote targets, so intel is ready the moment a candidate is scouted.
export function recordRemoteIntel(room: Room, memory: RoomMemory): void {
  const myUsername = Object.values(Game.spawns)[0]?.owner.username;
  const controller = room.controller;

  memory.remoteIntel = {
    sourceCount: getCachedFind(room, FIND_SOURCES).length,
    ownedByOther: controller?.owner !== undefined && !controller.my,
    reservedByOther:
      controller?.reservation !== undefined && controller.reservation.username !== myUsername,
    hasSourceKeeper: getCachedFind(room, FIND_HOSTILE_STRUCTURES).some(
      (structure) => structure.structureType === STRUCTURE_KEEPER_LAIR
    )
  };
}
