import { getRemoteCandidates, isRoomHostile, resolveRemoteRoom } from "../planning/remoteTargeting";
import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import { bodyCost, planBody, planMinerBody, planReserverBody, planScoutBody } from "./bodyPlanner";
import { SpawnDecision } from "./spawnDecision";

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
  remoteHaulerCount: number;
  sourcesWithoutContainerCount: number;
  sourcesNeedingMiner: Id<Source>[];
  remoteContainerCount: number;
  energyAvailable: number;
  energyCapacityAvailable: number;
}

// Sources/containers require live vision into the remote room (only present while the
// permanently-stationed reserver, or another remote creep, is actually there) - defaults
// to 0/empty when it isn't, same as spawnManager.ts's own "guard against missing
// visibility" convention. The reserver-first priority in decideNextRemoteSpawn already
// re-establishes vision on its own during the rare gap, so this never gets stuck.
function buildRemoteSourceState(
  remoteRoomName: string,
  minerSourceIds: Set<Id<Source>>
): {
  sourcesWithoutContainerCount: number;
  sourcesNeedingMiner: Id<Source>[];
  remoteContainerCount: number;
} {
  const remoteRoom = Game.rooms[remoteRoomName];
  if (!remoteRoom) {
    return { sourcesWithoutContainerCount: 0, sourcesNeedingMiner: [], remoteContainerCount: 0 };
  }

  const sources = getCachedFind(remoteRoom, FIND_SOURCES);
  const containers = getCachedFind(remoteRoom, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER
  );
  const containerAtSource = (source: Source) =>
    containers.find((container) => chebyshevDistance(container.pos, source.pos) <= 1);

  return {
    sourcesWithoutContainerCount: sources.filter((source) => !containerAtSource(source)).length,
    sourcesNeedingMiner: sources
      .filter((source) => containerAtSource(source) && !minerSourceIds.has(source.id))
      .map((source) => source.id),
    remoteContainerCount: containers.length
  };
}

export function buildRemoteRoomState(homeRoom: Room, remoteRoomName: string): RemoteRoomState {
  const lastHostileSeenTick = Memory.rooms[remoteRoomName]?.lastHostileSeenTick;

  let reserverCount = 0;
  let remoteHarvesterCount = 0;
  let remoteHaulerCount = 0;
  const minerSourceIds = new Set<Id<Source>>();
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.remoteRoom !== remoteRoomName) continue;
    if (creep.memory.role === "reserver") reserverCount++;
    if (creep.memory.role === "remoteHarvester") remoteHarvesterCount++;
    if (creep.memory.role === "remoteHauler") remoteHaulerCount++;
    if (creep.memory.role === "miner" && creep.memory.sourceId) {
      minerSourceIds.add(creep.memory.sourceId);
    }
  }

  return {
    homeRoomName: homeRoom.name,
    remoteRoomName,
    hostileRecentlySeen: isRoomHostile(lastHostileSeenTick, Game.time),
    reserverCount,
    remoteHarvesterCount,
    remoteHaulerCount,
    ...buildRemoteSourceState(remoteRoomName, minerSourceIds),
    energyAvailable: homeRoom.energyAvailable,
    energyCapacityAvailable: homeRoom.energyCapacityAvailable
  };
}

// Mirrors spawnManager.ts's own local priority: a reserver first (keeps the room
// reserved to us, and is the thing that establishes vision in the first place), then a
// miner for any source that already has a container but no miner - a real economy
// upgrade, worth pre-empting the round-robin below for the same reason local mining
// checks sourcesNeedingMiner before its own round-robin. Only once both of those are
// satisfied does a bootstrap remoteHarvester (for a still-uncontained source) or a
// remoteHauler (one per built container, same 1:1 heuristic as local's hauler target)
// get a turn. Existing workers already out there are accepted collateral risk -
// hostileRecentlySeen only pauses *new* spawns (see roles/shared.ts's
// retreatFromHostileRemote for what happens to creeps already assigned).
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

  if (state.sourcesNeedingMiner.length > 0) {
    const body = planMinerBody(state.energyCapacityAvailable);
    if (body.length > 0 && bodyCost(body) <= state.energyAvailable) {
      return {
        role: "miner",
        body,
        memory: {
          sourceId: state.sourcesNeedingMiner[0],
          homeRoom: state.homeRoomName,
          remoteRoom: state.remoteRoomName
        }
      };
    }
  }

  const targets: { role: "remoteHarvester" | "remoteHauler"; count: number; target: number }[] = [
    {
      role: "remoteHarvester",
      count: state.remoteHarvesterCount,
      target: state.sourcesWithoutContainerCount
    },
    { role: "remoteHauler", count: state.remoteHaulerCount, target: state.remoteContainerCount }
  ];

  for (const { role, count, target } of targets) {
    if (count >= target) continue;

    const body = planBody(role, state.energyCapacityAvailable);
    if (body.length > 0 && bodyCost(body) <= state.energyAvailable) {
      return {
        role,
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
