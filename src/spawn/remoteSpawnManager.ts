import { getRemoteCandidates, isRoomHostile, resolveRemoteRoom } from "../planning/remoteTargeting";
import { bodyCost, planBody, planReserverBody, planScoutBody } from "./bodyPlanner";
import { SpawnDecision } from "./spawnDecision";

// Flat target, not scaled per source count in v1 - reasonable for the 1-2 source remote
// rooms this feature targets; revisit once the container/miner/hauler split (v2) lands.
const REMOTE_HARVESTER_TARGET = 2;

// One scout at a time is plenty - scouts are 50E and this naturally rate-limits against
// local spawning, converging to "every candidate scouted" over a few spawn cycles.
export function decideScoutSpawn(
  homeRoomName: string,
  candidates: string[],
  candidateMemories: Record<string, RoomMemory | undefined>,
  liveScoutTargets: Set<string>
): SpawnDecision | null {
  const target = candidates.find(
    (candidate) =>
      candidateMemories[candidate]?.remoteIntel === undefined && !liveScoutTargets.has(candidate)
  );
  if (!target) return null;

  return {
    role: "scout",
    body: planScoutBody(),
    memory: { homeRoom: homeRoomName, remoteRoom: target }
  };
}

export interface RemoteRoomState {
  homeRoomName: string;
  remoteRoomName: string;
  hostileRecentlySeen: boolean;
  reserverCount: number;
  remoteHarvesterCount: number;
  energyAvailable: number;
  energyCapacityAvailable: number;
}

export function buildRemoteRoomState(homeRoom: Room, remoteRoomName: string): RemoteRoomState {
  const lastHostileSeenTick = Memory.rooms[remoteRoomName]?.lastHostileSeenTick;

  let reserverCount = 0;
  let remoteHarvesterCount = 0;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.remoteRoom !== remoteRoomName) continue;
    if (creep.memory.role === "reserver") reserverCount++;
    if (creep.memory.role === "remoteHarvester") remoteHarvesterCount++;
  }

  return {
    homeRoomName: homeRoom.name,
    remoteRoomName,
    hostileRecentlySeen: isRoomHostile(lastHostileSeenTick, Game.time),
    reserverCount,
    remoteHarvesterCount,
    energyAvailable: homeRoom.energyAvailable,
    energyCapacityAvailable: homeRoom.energyCapacityAvailable
  };
}

// A reserver first (keeps the room reserved to us, plausibly raises source capacity),
// then remoteHarvesters up to a flat target. Existing workers already out there are
// accepted collateral risk in v1 - hostileRecentlySeen only pauses *new* spawns.
export function decideNextRemoteSpawn(state: RemoteRoomState): SpawnDecision | null {
  if (state.hostileRecentlySeen) return null;

  if (state.reserverCount === 0) {
    const body = planReserverBody();
    if (bodyCost(body) <= state.energyAvailable) {
      return {
        role: "reserver",
        body,
        memory: { homeRoom: state.homeRoomName, remoteRoom: state.remoteRoomName }
      };
    }
    return null;
  }

  if (state.remoteHarvesterCount < REMOTE_HARVESTER_TARGET) {
    const body = planBody("remoteHarvester", state.energyCapacityAvailable);
    if (body.length > 0 && bodyCost(body) <= state.energyAvailable) {
      return {
        role: "remoteHarvester",
        body,
        memory: { homeRoom: state.homeRoomName, remoteRoom: state.remoteRoomName }
      };
    }
  }

  return null;
}

// Only called once the home room's own economy is fully staffed for this tick (see
// hasUnmetLocalNeed in spawnManager.ts) - remote expansion must never compete with local
// needs for spawn time.
export function decideRemoteSpawn(room: Room): SpawnDecision | null {
  Memory.rooms[room.name] = Memory.rooms[room.name] || {};
  const homeMemory = Memory.rooms[room.name];

  // Short-circuit before touching Game.map at all once resolved - no need to
  // re-derive the exit list every tick for a decision that's already been made.
  if (homeMemory.remoteRoom) {
    return decideNextRemoteSpawn(buildRemoteRoomState(room, homeMemory.remoteRoom));
  }

  const candidates = getRemoteCandidates(room.name);
  const candidateMemories: Record<string, RoomMemory | undefined> = {};
  for (const candidate of candidates) {
    candidateMemories[candidate] = Memory.rooms[candidate];
  }

  const remoteRoomName = resolveRemoteRoom(room.name, homeMemory, candidateMemories);
  if (remoteRoomName) {
    return decideNextRemoteSpawn(buildRemoteRoomState(room, remoteRoomName));
  }

  const liveScoutTargets = new Set(
    Object.values(Game.creeps)
      .filter((creep) => creep.memory.role === "scout")
      .map((creep) => creep.memory.remoteRoom)
      .filter((remoteRoom): remoteRoom is string => remoteRoom !== undefined)
  );

  return decideScoutSpawn(room.name, candidates, candidateMemories, liveScoutTargets);
}
