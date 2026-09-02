import { log } from "../logging/logger";
import { isLocalHostileRecentlySeen } from "../planning/roomPlanner";
import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import { bodyCost, planBody, planMinerBody } from "./bodyPlanner";
import { isNearingDeath, replacementLeadTime } from "./preSpawn";
import { decideKeeperSpawn } from "./keeperSpawnManager";
import { decideRemoteSpawn } from "./remoteSpawnManager";
import { SpawnDecision } from "./spawnDecision";

export type { SpawnDecision };

export interface RoomState {
  creepCounts: Record<CreepRole, number>;
  sourcesWithoutContainerCount: number;
  sourcesNeedingMiner: Id<Source>[];
  constructionSiteCount: number;
  containerCount: number;
  energyAvailable: number;
  energyCapacityAvailable: number;
  controllerLevel: number;
  hostileCreepCount: number;
  hostileRecentlySeen: boolean;
}

// Live-capped so a swarm doesn't queue an unbounded number of defenders.
const DEFENDER_TARGET_CAP = 3;

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

// Shared by decideNextSpawn and hasUnmetLocalNeed so the two can't drift out of sync -
// sizing capacity is deliberately left out here, since "is anything under target"
// doesn't depend on what body size would be affordable for it.
function buildRoleTargets(
  state: RoomState
): { role: "harvester" | "hauler" | "upgrader" | "builder"; target: number }[] {
  return [
    { role: "harvester", target: harvesterTargetFor(state) },
    { role: "hauler", target: state.containerCount },
    { role: "upgrader", target: upgraderTargetFor(state) },
    { role: "builder", target: builderTargetFor(state) }
  ];
}

// "Fully staffed" and "something's needed but unaffordable at the ideal body size right
// now" both make decideNextSpawn return null - conflating them would let remote spawning
// spend energy the home room was just deemed too poor to spend on its own unmet need.
//
// A role only one creep short of target doesn't count as unmet, though - it's treated
// the same as decideNextSpawn's own "close enough to wait for the ideal body" threshold
// (feederSizingCapacity's severelyUnderTarget check). Found live: a room's upgrader
// target (4) sat at 3 almost continuously, since each 4th upgrader needs a full-capacity
// 1800-energy body that took ~120 ticks to reaccumulate every time one died and got
// replaced - under a strict "any deficit blocks remote spawning" rule, remote expansion
// got almost no opportunities to ever run.
export function hasUnmetLocalNeed(state: RoomState): boolean {
  if (state.sourcesNeedingMiner.length > 0) return true;
  return buildRoleTargets(state).some(({ role, target }) => target - state.creepCounts[role] > 1);
}

// A defender to fight is worth pre-empting even a starving economy for - checked
// before everything else, including the miner bootstrap check. Capped at the live
// hostile count (not spawned past what's actually there) so a lone Invader doesn't
// trigger a full DEFENDER_TARGET_CAP-sized garrison.
function decideActiveThreatDefender(state: RoomState): SpawnDecision | null {
  if (state.hostileCreepCount === 0) return null;

  const target = Math.min(state.hostileCreepCount, DEFENDER_TARGET_CAP);
  if (state.creepCounts.defender >= target) return null;

  const body = planBody("defender", state.energyCapacityAvailable);
  if (body.length === 0 || bodyCost(body) > state.energyAvailable) return null;

  return { role: "defender", body };
}

// A hostile seen recently but not live right now doesn't justify preempting economy
// roles - unlike decideActiveThreatDefender, this is only ever tried as a last resort,
// after every other role's target is already met. Keeps exactly one defender around
// for a while after a sighting ages, in case the same threat comes back, without ever
// competing with an actual economy deficit for the same spawn slot.
function decideStickyDefender(state: RoomState): SpawnDecision | null {
  if (!state.hostileRecentlySeen || state.creepCounts.defender >= 1) return null;

  const body = planBody("defender", state.energyCapacityAvailable);
  if (body.length === 0 || bodyCost(body) > state.energyAvailable) return null;

  return { role: "defender", body };
}

export function decideNextSpawn(state: RoomState): SpawnDecision | null {
  const activeThreatDefender = decideActiveThreatDefender(state);
  if (activeThreatDefender) return activeThreatDefender;

  // A harvester alone can grow the spawn's energy (it self-delivers), and so can a
  // miner+hauler pair (miner fills a container, hauler relays it) - but a hauler
  // *without* a miner has nothing to haul, and a miner *without* a hauler just piles
  // energy up in a container nothing collects. Either half alone is exactly as stuck as
  // having neither: confirmed live twice - once as a lone bootstrap miner with an
  // unaffordable full-size hauler, and again as a lone hauler with zero miners, where
  // energyAvailable sat frozen for hundreds of ticks because every miner/harvester/
  // hauler spawn attempt sized itself for full capacity and nothing was affordable.
  // Size the roles that can restore a working economy - harvester, miner, and hauler -
  // down to whatever's actually on hand until a genuine harvester-or-pair exists.
  const hasWorkingEconomy =
    state.creepCounts.harvester > 0 ||
    (state.creepCounts.miner > 0 && state.creepCounts.hauler > 0);
  const bootstrapSizingCapacity = hasWorkingEconomy
    ? state.energyCapacityAvailable
    : Math.min(state.energyCapacityAvailable, state.energyAvailable);

  if (state.sourcesNeedingMiner.length > 0) {
    const body = planMinerBody(bootstrapSizingCapacity);
    if (body.length > 0 && bodyCost(body) <= state.energyAvailable) {
      return { role: "miner", body, memory: { sourceId: state.sourcesNeedingMiner[0] } };
    }
  }

  // Once a working economy exists, it's ordinarily worth waiting for the full-capacity
  // "ideal" body instead of risking a permanently undersized creep (see the "skips a
  // role" tests). But that only holds while the role is close to its target - confirmed
  // live: with a hauler target of 5 and only 1 spawned, a single hauler couldn't grow
  // energyAvailable fast enough to ever afford a second at full size, leaving the room
  // hauler-starved for hundreds of ticks. Being more than one creep short of target is
  // treated the same as not having a working economy at all: downsize now rather than wait.
  function feederSizingCapacity(role: "harvester" | "hauler", target: number): number {
    const severelyUnderTarget = target - state.creepCounts[role] > 1;
    return hasWorkingEconomy && !severelyUnderTarget
      ? state.energyCapacityAvailable
      : Math.min(state.energyCapacityAvailable, state.energyAvailable);
  }

  for (const { role, target } of buildRoleTargets(state)) {
    if (state.creepCounts[role] >= target) continue;

    const sizingCapacity =
      role === "harvester" || role === "hauler"
        ? feederSizingCapacity(role, target)
        : state.energyCapacityAvailable;

    const body = planBody(role, sizingCapacity);
    if (body.length > 0 && bodyCost(body) <= state.energyAvailable) return { role, body };
  }

  return decideStickyDefender(state);
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

  // scout/reserver/remoteHarvester/remoteHauler/keeperHarvester are remote-only roles,
  // tracked separately by the remote/keeper spawn passes (their memory.remoteRoom, not
  // creep.room, is what matters for counting them) - present here at 0 only to satisfy
  // Record<CreepRole, number>. A remote miner is also excluded from this room's own
  // count naturally, since it physically sits in the remote room (creep.room.name !==
  // room.name below). defender is a genuine home-room role (unlike the above) - its 0
  // here is just the loop's usual starting point, incremented below like every other
  // local role.
  const creepCounts: Record<CreepRole, number> = {
    harvester: 0,
    upgrader: 0,
    builder: 0,
    hauler: 0,
    miner: 0,
    scout: 0,
    reserver: 0,
    remoteHarvester: 0,
    remoteHauler: 0,
    keeperHarvester: 0,
    defender: 0
  };
  const harvesterCreeps: Creep[] = [];
  // Tracks the healthiest (highest ticksToLive) miner currently assigned to each
  // source, not just whether one exists - a source whose only assigned miner is about
  // to die still needs a replacement queued, same as one with no miner at all (see
  // sourcesNeedingMiner below). A still-spawning miner has ticksToLive === undefined;
  // treat that as healthy since it can't need a replacement before it even exists.
  const minerTicksToLiveBySource = new Map<Id<Source>, number>();

  const containers = getCachedFind(room, FIND_STRUCTURES).filter(
    (structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER
  );

  // Upgraders, builders, and haulers are fungible (unlike miners, any one can replace
  // any other of the same role), so a dying one just needs to stop counting toward the
  // target early - decideNextSpawn's usual "under target" check takes care of the rest.
  //
  // Working upgraders always head straight for the controller (see upgrader.ts) - a
  // fixed position - so, same as the miner case, that lead time is precise. Builders
  // re-target every tick to whichever construction site is closest by path (or the
  // controller once none remain, see builder.ts), and haulers re-target every tick
  // between whichever container needs withdrawing from and wherever energy needs
  // delivering (hauler.ts) - neither has a fixed destination to precompute a distance
  // to in advance. "spawn -> nearest site/container right now" is the best available
  // proxy for where a freshly-spawned creep would actually head first, and it's
  // inherently a soft estimate rather than a guarantee.
  const upgraderLeadTime = room.controller
    ? replacementLeadTime(
        planBody("upgrader", room.energyCapacityAvailable).length,
        chebyshevDistance(spawn.pos, room.controller.pos)
      )
    : 0;

  const nearestSite = spawn.pos.findClosestByPath(getCachedFind(room, FIND_CONSTRUCTION_SITES));
  const builderTargetPos = nearestSite?.pos ?? room.controller?.pos;
  const builderLeadTime = builderTargetPos
    ? replacementLeadTime(
        planBody("builder", room.energyCapacityAvailable).length,
        chebyshevDistance(spawn.pos, builderTargetPos)
      )
    : 0;

  const nearestContainer = spawn.pos.findClosestByPath(containers);
  const haulerLeadTime = nearestContainer
    ? replacementLeadTime(
        planBody("hauler", room.energyCapacityAvailable).length,
        chebyshevDistance(spawn.pos, nearestContainer.pos)
      )
    : 0;

  const preSpawnLeadTimeByRole: Partial<Record<CreepRole, number>> = {
    upgrader: upgraderLeadTime,
    builder: builderLeadTime,
    hauler: haulerLeadTime
  };

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;

    const leadTime = preSpawnLeadTimeByRole[creep.memory.role];
    if (leadTime === undefined || !isNearingDeath(creep.ticksToLive, leadTime)) {
      creepCounts[creep.memory.role]++;
    }

    if (creep.memory.role === "harvester") harvesterCreeps.push(creep);
    if (creep.memory.role === "miner" && creep.memory.sourceId) {
      const ticksToLive = creep.ticksToLive ?? Infinity;
      const best = minerTicksToLiveBySource.get(creep.memory.sourceId);
      if (best === undefined || ticksToLive > best) {
        minerTicksToLiveBySource.set(creep.memory.sourceId, ticksToLive);
      }
    }
  }

  const activeSources = getCachedFind(room, FIND_SOURCES_ACTIVE);
  const sourceContainer = (source: Source) =>
    containers.find((container) => chebyshevDistance(source.pos, container.pos) <= 1);
  const minerBodyLength = planMinerBody(room.energyCapacityAvailable).length;

  const state: RoomState = {
    creepCounts,
    sourcesWithoutContainerCount: activeSources.filter((source) => !sourceContainer(source)).length,
    sourcesNeedingMiner: activeSources
      .filter((source) => {
        const container = sourceContainer(source);
        if (!container) return false;

        const bestTicksToLive = minerTicksToLiveBySource.get(source.id);
        if (bestTicksToLive === undefined) return true;

        const leadTime = replacementLeadTime(
          minerBodyLength,
          chebyshevDistance(spawn.pos, container.pos)
        );
        return isNearingDeath(bestTicksToLive, leadTime);
      })
      .map((source) => source.id),
    constructionSiteCount: getCachedFind(room, FIND_CONSTRUCTION_SITES).length,
    containerCount: containers.length,
    energyAvailable: room.energyAvailable,
    energyCapacityAvailable: room.energyCapacityAvailable,
    controllerLevel: room.controller?.level ?? 0,
    hostileCreepCount: getCachedFind(room, FIND_HOSTILE_CREEPS).length,
    hostileRecentlySeen: isLocalHostileRecentlySeen(
      Memory.rooms[room.name]?.lastHostileSeenTick,
      Game.time
    )
  };

  const excessHarvesters = creepCounts.harvester - harvesterTargetFor(state);
  if (excessHarvesters > 0) {
    recycleSurplusHarvesters(spawn, harvesterCreeps, excessHarvesters);
  }

  const decision =
    decideNextSpawn(state) ??
    (hasUnmetLocalNeed(state) ? null : (decideRemoteSpawn(room) ?? decideKeeperSpawn(room)));
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
