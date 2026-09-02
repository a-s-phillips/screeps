import { getRemoteCandidates, resolveRemoteRoom } from "../planning/remoteTargeting";
import { planScoutBody } from "./bodyPlanner";
import { SpawnDecision } from "./spawnDecision";

// One scout at a time is plenty - scouts are 50E and this naturally rate-limits against
// local spawning, converging to "every candidate scouted" over a few spawn cycles.
export function decideScoutSpawn(
  candidates: string[],
  candidateMemories: Record<string, RoomMemory | undefined>,
  liveScoutTargets: Set<string>
): SpawnDecision | null {
  const target = candidates.find(
    (candidate) =>
      candidateMemories[candidate]?.remoteIntel === undefined && !liveScoutTargets.has(candidate)
  );
  if (!target) return null;

  return { role: "scout", body: planScoutBody(), memory: { remoteRoom: target } };
}

// Only called once the home room's own economy is fully staffed for this tick (see
// hasUnmetLocalNeed in spawnManager.ts) - remote expansion must never compete with local
// needs for spawn time. Reserver/remoteHarvester staffing, once a target is resolved,
// comes in a later slice of this feature; for now a resolved target just means nothing
// more to do here.
export function decideRemoteSpawn(room: Room): SpawnDecision | null {
  Memory.rooms[room.name] = Memory.rooms[room.name] || {};
  const homeMemory = Memory.rooms[room.name];

  // Short-circuit before touching Game.map at all once resolved - no need to
  // re-derive the exit list every tick for a decision that's already been made.
  if (homeMemory.remoteRoom) return null;

  const candidates = getRemoteCandidates(room.name);
  const candidateMemories: Record<string, RoomMemory | undefined> = {};
  for (const candidate of candidates) {
    candidateMemories[candidate] = Memory.rooms[candidate];
  }

  const remoteRoomName = resolveRemoteRoom(room.name, homeMemory, candidateMemories);
  if (remoteRoomName) return null;

  const liveScoutTargets = new Set(
    Object.values(Game.creeps)
      .filter((creep) => creep.memory.role === "scout")
      .map((creep) => creep.memory.remoteRoom)
      .filter((remoteRoom): remoteRoom is string => remoteRoom !== undefined)
  );

  return decideScoutSpawn(candidates, candidateMemories, liveScoutTargets);
}
