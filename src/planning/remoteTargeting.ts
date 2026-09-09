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

// See RemoteIntel.ownedByMe's own comment for why this can't be derived from
// !ownedByOther - our own home room reports ownedByOther: false too.
export function isRoomOwnedByMe(remoteIntel: RemoteIntel | undefined): boolean {
  return remoteIntel?.ownedByMe === true;
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
//
// A tier-1 room already confirmed keeper-guarded is skipped as a *gateway* into tier 2,
// not just excluded as a mining target in its own right - found live: W55N25's only
// route from home runs straight through W56N25's four active keeper lairs, and
// travelToRoom has no hostile-room avoidance, so every reserver/scout/hauler sent there
// died crossing it. Reading Memory directly (rather than requiring vision) means this
// only protects against a gateway that's *already* been scouted - a still-unscouted
// tier-1 room's exits are still offered, accepting the same one-time discovery cost
// hasSourceKeeper itself does. A tier-2 room bordering more than one tier-1 gateway is
// still reachable via any gateway that isn't keeper-guarded.
export function getRemoteCandidateTiers(homeRoomName: string): string[][] {
  const tier1 = describeExitRooms(homeRoomName);
  const seen = new Set([homeRoomName, ...tier1]);
  const tier2: string[] = [];
  for (const room of tier1) {
    if (Memory.rooms[room]?.remoteIntel?.hasSourceKeeper === true) continue;
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
      // A room we already own (most often our own home room, for a sibling picking its
      // own remote targets) is never a legitimate new pick here - the one legitimate way
      // a resolved room ends up owned by us is the claimTarget/colonizer promotion path,
      // which writes directly into remoteRooms and never goes through this picker. Found
      // live: W57N24 picked its own home room W57N25 as a remote candidate, since
      // ownedByOther alone doesn't catch "owned by us".
      !intel.ownedByMe &&
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

// Cleans up remoteRooms entries that pickBestCandidate's ownedByMe guard now stops from
// being picked, but which can still exist in Memory from before that guard existed (a
// slot picked while the candidate was still unowned, then later claimed by us some other
// way than the claimTarget/colonizer path) - found live: W57N24's remoteRooms contained
// its own home room, W57N25, self-targeted before this guard shipped. A resolved room
// owned by us is only ever legitimate via claimTarget (see its own comment: "the reserver
// claims it instead of reserving" - the sole intentional owned-and-resolved case, which
// also keeps decideCourierSpawn's donor->sibling lookup working). Anything else owned by
// us occupying a slot is dead weight - it can never be picked again (pickBestCandidate
// excludes it) and it's not being put to any use (not the courier's target), so freeing
// the slot lets resolveNextRemoteRoom pick a real replacement instead of leaving it stuck
// forever, same "sticky, never re-evaluated" tradeoff resolveNextRemoteRoom already
// accepts elsewhere. A candidate with no recorded intel yet is left alone rather than
// guessed at - there's no evidence yet that it needs pruning.
export function pruneOwnedRemoteRooms(
  homeMemory: RoomMemory,
  intelByRoom: Record<string, RemoteIntel | undefined>
): void {
  const chosen = homeMemory.remoteRooms;
  if (!chosen) return;

  homeMemory.remoteRooms = chosen.filter((room) => {
    if (room === homeMemory.claimTarget) return true;
    return !isRoomOwnedByMe(intelByRoom[room]);
  });
}

// Single source of truth for "who are we" - reserver.ts also needs this to tell its own
// reservation renewal apart from a rival's, and duplicating the lookup risks the two
// drifting apart on how "us" is identified.
export function getMyUsername(): string | undefined {
  return Object.values(Game.spawns)[0]?.owner.username;
}

// Mirrors claimController's own precondition (GCL must allow one more owned room than we
// currently have). Single source of truth so reserver.ts (deciding whether to actually
// claim) and remoteSpawnManager.ts (deciding whether to start pre-positioning a colonizer
// or defender ahead of that) can't drift apart on what "ready" means.
export function hasGclHeadroomForAnotherRoom(): boolean {
  const ownedRoomCount = Object.values(Game.rooms).filter((room) => room.controller?.my).length;
  return Game.gcl.level > ownedRoomCount;
}

// No measured GCL point-gain rate exists yet (unlike REMOTE_HAULER_ROUND_TRIP_ESTIMATE,
// which came from a real timed measurement) - this is a deliberately generous,
// documented-as-approximate margin rather than false precision. GCL points accrue at
// roughly the same pace as controller upgrade progress (observed ~5/tick on W57N25 at
// RCL5), so even a wide margin here still resolves to far more lead time than a
// colonizer/defender's cross-room travel (tens of ticks) needs - dispatching "too early"
// just means a creep idles for a while, not a wasted spawn or a missed window.
export const CLAIM_WINDOW_GCL_MARGIN = 20000;

// True once it's worth pre-positioning a colonizer/defender at a claim target ahead of
// the claim itself actually landing - see hasGclHeadroomForAnotherRoom's own comment for
// why "already ready" also counts (reserver.ts claims the same tick that flips true, so a
// creep that only started traveling then would arrive too late to have been "pre"-anything).
export function isClaimWindowApproaching(): boolean {
  if (hasGclHeadroomForAnotherRoom()) return true;
  return Game.gcl.progressTotal - Game.gcl.progress <= CLAIM_WINDOW_GCL_MARGIN;
}

// Overwritten every tick while visible, so it can't go stale while a scout/reserver/
// remoteHarvester is present - called for every room the bot currently has vision into,
// not just chosen remote targets, so intel is ready the moment a candidate is scouted.
export function recordRemoteIntel(room: Room, memory: RoomMemory): void {
  const myUsername = getMyUsername();
  const controller = room.controller;

  memory.remoteIntel = {
    sourceCount: getCachedFind(room, FIND_SOURCES).length,
    ownedByOther: controller?.owner !== undefined && !controller.my,
    ownedByMe: controller?.my === true,
    reservedByOther:
      controller?.reservation !== undefined && controller.reservation.username !== myUsername,
    hasSourceKeeper: getCachedFind(room, FIND_HOSTILE_STRUCTURES).some(
      (structure) => structure.structureType === STRUCTURE_KEEPER_LAIR
    )
  };
}
