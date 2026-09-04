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

// Unlike isRoomHostile, this has no recency window - a room another player has claimed
// doesn't "age out" back into safety on its own the way a passing hostile sighting does.
export function isRoomOwnedByOther(remoteIntel: RemoteIntel | undefined): boolean {
  return remoteIntel?.ownedByOther === true;
}

// Static map exit topology - no vision required, works for a room the bot has never seen.
function describeExitRooms(roomName: string): string[] {
  const exits = Game.map.describeExits(roomName);
  return exits ? Object.values(exits) : [];
}

// Tier 1: direct exits of the home room. Tier 2: exits of those rooms, one hop further -
// needed because a home room's direct exits can all end up already spoken for at once
// (staffed, owned by another player, reserved, or a keeper room), leaving the picker with
// zero legal candidates even though further rooms are perfectly reachable. Deduplicated
// against the home room and tier 1 itself, so a loop back through a neighbor doesn't
// reintroduce something already known as a "new" second-order candidate.
export function getRemoteCandidateTiers(homeRoomName: string): string[][] {
  const tier1 = describeExitRooms(homeRoomName);
  const seen = new Set([homeRoomName, ...tier1]);
  const tier2: string[] = [];
  for (const room of tier1) {
    for (const exitRoom of describeExitRooms(room)) {
      if (seen.has(exitRoom)) continue;
      seen.add(exitRoom);
      tier2.push(exitRoom);
    }
  }
  return [tier1, tier2];
}

export function getRemoteCandidates(homeRoomName: string): string[] {
  return getRemoteCandidateTiers(homeRoomName).flat();
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

// Home rooms can staff up to this many remote rooms at once - not unbounded expansion,
// just enough to be a real second lever once v2's economics have proven out on the first.
export const MAX_REMOTE_ROOMS = 2;

// A one-time, sticky decision per slot: once a remote room is chosen, it's never
// re-evaluated in v1 (no story yet for "the choice turned out worse than expected").
// Resolves at most one additional room per call - the caller re-calls this once the
// newly-resolved room's own spawn needs are satisfied, same as any other role target.
//
// Evaluated tier by tier (direct exits first, then one hop further) rather than as one
// flat pool - pickBestCandidate already refuses to decide until every candidate it's
// given has recorded intel, and a flat ~20-room pool would then block a decision until
// every single one of them was scouted, even when a much closer candidate might already
// be viable. Tier by tier, a wider search only starts once the closer one is fully known
// and confirmed to have nothing usable in it.
export function resolveNextRemoteRoom(
  homeRoomName: string,
  homeMemory: RoomMemory,
  candidateMemories: Record<string, RoomMemory | undefined>
): string | undefined {
  const chosen = homeMemory.remoteRooms ?? [];
  if (chosen.length >= MAX_REMOTE_ROOMS) return undefined;

  for (const tier of getRemoteCandidateTiers(homeRoomName)) {
    const candidates = tier.filter((candidate) => !chosen.includes(candidate));
    if (candidates.length === 0) continue;

    const intelByRoom: Record<string, RemoteIntel | undefined> = {};
    for (const candidate of candidates) {
      intelByRoom[candidate] = candidateMemories[candidate]?.remoteIntel;
    }

    const best = pickBestCandidate(candidates, intelByRoom);
    if (best) {
      homeMemory.remoteRooms = [...chosen, best];
      return best;
    }

    if (candidates.some((candidate) => intelByRoom[candidate] === undefined)) return undefined;
  }

  return undefined;
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
