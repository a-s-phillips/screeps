import { log } from "../logging/logger";
import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import { bodyCost, planBody, planMinerBody } from "./bodyPlanner";

export interface RoomState {
  creepCounts: Record<CreepRole, number>;
  sourcesWithoutContainerCount: number;
  sourcesNeedingMiner: Id<Source>[];
  constructionSiteCount: number;
  containerCount: number;
  energyAvailable: number;
  energyCapacityAvailable: number;
  controllerLevel: number;
}

interface SpawnDecision {
  role: CreepRole;
  body: BodyPartConstant[];
  memory?: Partial<CreepMemory>;
}

// A source with a built container gets a miner instead (see planMinerBody) - it hits
// the true saturation cap alone, so mobile harvesters are only needed for sources that
// don't have one yet.
function harvesterTargetFor(state: RoomState): number {
  return state.sourcesWithoutContainerCount * 2;
}

const UPGRADER_TARGET_CAP = 4;
// CONTROLLER_MAX_UPGRADE_PER_TICK caps total useful controller upgrade power at 15
// energy/tick once the room hits RCL8 - a single capacity-sized upgrader body already
// meets or exceeds that alone, so more upgraders past that point are wasted spawns.
const CONTROLLER_UPGRADE_POWER_CAP_LEVEL = 8;

function upgraderTargetFor(state: RoomState): number {
  if (state.controllerLevel >= CONTROLLER_UPGRADE_POWER_CAP_LEVEL) return 1;
  return Math.min(state.controllerLevel + 1, UPGRADER_TARGET_CAP);
}

// Scales with actual queue depth instead of a flat "any sites? then 2" gate, capped so
// builders don't crowd out other roles' share of energy once the queue runs long.
const BUILDER_TARGET_CAP = 3;

function builderTargetFor(state: RoomState): number {
  return Math.min(state.constructionSiteCount, BUILDER_TARGET_CAP);
}

export function decideNextSpawn(state: RoomState): SpawnDecision | null {
  // Only harvester (self-delivers) and hauler (withdraws from a container, delivers to
  // spawn) ever get energy INTO the spawn - a miner alone just piles energy up in a
  // container that nothing collects. With neither a harvester nor a hauler, energy can
  // only shrink from here, so waiting for the full-capacity "ideal" body to become
  // affordable would deadlock the room forever (confirmed live: a lone bootstrap miner
  // filled its container while the hauler needed to move that energy stayed
  // permanently unaffordable at full sizing). Size the roles that can restore a
  // spawn-feeder - harvester, miner, and hauler - down to whatever's actually on hand
  // in that one case. Once a harvester or hauler exists, revert to the normal "wait,
  // don't shrink" policy - the room isn't stuck, so there's no need to risk a
  // permanently undersized creep.
  const hasSpawnFeeder = state.creepCounts.harvester + state.creepCounts.hauler > 0;
  const bootstrapSizingCapacity = hasSpawnFeeder
    ? state.energyCapacityAvailable
    : Math.min(state.energyCapacityAvailable, state.energyAvailable);

  if (state.sourcesNeedingMiner.length > 0) {
    const body = planMinerBody(bootstrapSizingCapacity);
    if (body.length > 0 && bodyCost(body) <= state.energyAvailable) {
      return { role: "miner", body, memory: { sourceId: state.sourcesNeedingMiner[0] } };
    }
  }

  const targets: { role: Exclude<CreepRole, "miner">; target: number; sizingCapacity: number }[] = [
    {
      role: "harvester",
      target: harvesterTargetFor(state),
      sizingCapacity: bootstrapSizingCapacity
    },
    { role: "hauler", target: state.containerCount, sizingCapacity: bootstrapSizingCapacity },
    {
      role: "upgrader",
      target: upgraderTargetFor(state),
      sizingCapacity: state.energyCapacityAvailable
    },
    {
      role: "builder",
      target: builderTargetFor(state),
      sizingCapacity: state.energyCapacityAvailable
    }
  ];

  for (const { role, target, sizingCapacity } of targets) {
    if (state.creepCounts[role] >= target) continue;

    const body = planBody(role, sizingCapacity);
    if (body.length > 0 && bodyCost(body) <= state.energyAvailable) return { role, body };
  }

  return null;
}

// Harvesters pick "nearest active source" fresh each tick rather than sticking to one
// (see harvester.ts), so there's no cheap way to tell exactly which harvester is now
// redundant once a source gains a miner. Recycling the oldest excess by count instead -
// via a partial energy refund - converges the population to the new target promptly
// without retrofitting sticky source-assignment onto a role that deliberately doesn't
// have it.
function recycleSurplusHarvesters(
  spawn: StructureSpawn,
  harvesters: Creep[],
  excessCount: number
): void {
  const sorted = [...harvesters].sort((a, b) => (a.ticksToLive ?? 0) - (b.ticksToLive ?? 0));

  let recycled = 0;
  for (const creep of sorted) {
    if (recycled >= excessCount) break;
    if (chebyshevDistance(creep.pos, spawn.pos) > 1) continue;

    spawn.recycleCreep(creep);
    recycled++;
  }
}

export function runSpawning(spawn: StructureSpawn, room: Room): void {
  if (spawn.spawning) return;

  const creepCounts: Record<CreepRole, number> = {
    harvester: 0,
    upgrader: 0,
    builder: 0,
    hauler: 0,
    miner: 0
  };
  const harvesterCreeps: Creep[] = [];
  const existingMinerSourceIds = new Set<Id<Source>>();

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;

    creepCounts[creep.memory.role]++;
    if (creep.memory.role === "harvester") harvesterCreeps.push(creep);
    if (creep.memory.role === "miner" && creep.memory.sourceId) {
      existingMinerSourceIds.add(creep.memory.sourceId);
    }
  }

  const activeSources = getCachedFind(room, FIND_SOURCES_ACTIVE);
  const containers = getCachedFind(room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER
  );
  const sourceHasContainer = (source: Source) =>
    containers.some((container) => chebyshevDistance(source.pos, container.pos) <= 1);

  const state: RoomState = {
    creepCounts,
    sourcesWithoutContainerCount: activeSources.filter((source) => !sourceHasContainer(source))
      .length,
    sourcesNeedingMiner: activeSources
      .filter((source) => sourceHasContainer(source) && !existingMinerSourceIds.has(source.id))
      .map((source) => source.id),
    constructionSiteCount: getCachedFind(room, FIND_CONSTRUCTION_SITES).length,
    containerCount: containers.length,
    energyAvailable: room.energyAvailable,
    energyCapacityAvailable: room.energyCapacityAvailable,
    controllerLevel: room.controller?.level ?? 0
  };

  const excessHarvesters = creepCounts.harvester - harvesterTargetFor(state);
  if (excessHarvesters > 0) {
    recycleSurplusHarvesters(spawn, harvesterCreeps, excessHarvesters);
  }

  const decision = decideNextSpawn(state);
  if (!decision) return;

  const name = `${decision.role}_${Game.time}`;
  const result = spawn.spawnCreep(decision.body, name, {
    memory: { role: decision.role, working: false, ...decision.memory }
  });

  if (result === OK) {
    log("spawn", { role: decision.role, name });
  } else {
    log("spawn_failed", { role: decision.role, result });
  }
}
