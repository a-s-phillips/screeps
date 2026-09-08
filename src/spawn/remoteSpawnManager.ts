import {
  getRemoteCandidates,
  isClaimWindowApproaching,
  isRoomHostile,
  isRoomOwnedByOther,
  MAX_REMOTE_ROOMS,
  resolveNextRemoteRoom
} from "../planning/remoteTargeting";
import { chebyshevDistance } from "../utils/grid";
import { getCachedFind } from "../utils/roomCache";
import { bodyCost, planBody, planMinerBody, planReserverBody, planScoutBody } from "./bodyPlanner";
import { isNearingDeath, replacementLeadTime } from "./preSpawn";
import { SpawnDecision } from "./spawnDecision";

// Unverified guess pending a real measured round-trip time per remote room - same
// tuning caveat as keeperTargeting.ts's KEEPER_ROOM_TRAVEL_ESTIMATE. Derived from one
// live measurement (W57N24, a fatigue-weighted shortest path from spawn to the remote
// container: ~58 tiles out at full speed empty, ~110 ticks back loaded and unroaded).
export const REMOTE_HAULER_ROUND_TRIP_ESTIMATE = 170;

// NOT the hauler's empty-outbound-leg figure, despite both being "unloaded" - a hauler's
// CARRY parts generate zero fatigue when empty, but a reserver's CLAIM part is heavy the
// entire trip, both directions, so it doesn't get that break. A real fatigue-weighted
// Dijkstra over this route's live terrain (8 swamp tiles out of 59) gives 91 ticks
// one-way to W57N24's controller, not the 58 the hauler measurement would suggest -
// confirmed live when this constant was first added undercounted by ~36%, which was
// eating into the anticipatory-replacement lead time the pre-spawn fix depends on.
export const RESERVER_TRAVEL_ESTIMATE = 91;

// neededClaimParts (see decideNextRemoteSpawn) chases the rival's current CLAIM count
// plus one, forever - an opponent that keeps growing turns reservation contests into an
// unbounded energy sink with no way to ever actually win, since the target keeps moving.
// Capping how many CLAIM parts we'll ever build into a single reserver bounds that cost:
// past this point we accept a losing (or merely contested) reservation rather than keep
// escalating, which is fine because a losing reservation doesn't stop mining or hauling -
// it only blocks new construction in that room - and because a rival worth this much
// spawn energy is better answered with a combat solution (killing their reserver
// outright) than with an ever-larger one of our own.
export const MAX_RESERVER_CLAIM_PARTS = 3;

// A source regenerates SOURCE_ENERGY_CAPACITY every ENERGY_REGEN_TIME ticks - the same
// sustained-yield expression bodyPlanner.ts's SOURCE_SATURATION_WORK is built from.
const SOURCE_YIELD_PER_TICK = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME;

// A flat 1-hauler-per-container target (the original design) assumed a single hauler's
// round trip is short enough to keep up with a saturated source - not true once the trip
// is more than a few dozen ticks each way. Found live: W57N24's one hauler was
// delivering ~3.9 energy/tick against a fully-saturated 10-energy/tick source, so the
// container sat permanently full with the surplus spilling and decaying on the ground.
// Target is now sized to how many haulers it actually takes, at this room's current
// affordable body, to match the source's sustained yield. roundTripEstimate is an
// explicit parameter (defaulting to the module constant) rather than read directly, so
// this stays unit-testable without depending on whatever the tuned value currently is -
// same convention as roomPlanner.ts's planTowers/planRamparts overridePriority.
export function remoteHaulerTarget(
  state: RemoteRoomState,
  roundTripEstimate = REMOTE_HAULER_ROUND_TRIP_ESTIMATE
): number {
  if (state.remoteContainerCount === 0) return 0;

  const cargoCapacity =
    planBody("remoteHauler", state.energyCapacityAvailable).filter((part) => part === CARRY)
      .length * CARRY_CAPACITY;
  if (cargoCapacity === 0) return 0;

  const haulerThroughput = cargoCapacity / roundTripEstimate;
  const desiredThroughput = state.remoteContainerCount * SOURCE_YIELD_PER_TICK;
  return Math.ceil(desiredThroughput / haulerThroughput);
}

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
  ownedByOther: boolean;
  reserverCount: number;
  ourReserverClaimParts: number;
  hostileReservationClaimParts: number;
  hostileCombatCreepCount: number;
  remoteHarvesterCount: number;
  remoteHaulerCount: number;
  sourcesWithoutContainerCount: number;
  sourcesNeedingMiner: Id<Source>[];
  remoteContainerCount: number;
  energyAvailable: number;
  energyCapacityAvailable: number;
}

// attackController and reserveController both move a controller's reservation endTime by
// exactly 1 tick per active CLAIM part per tick (CONTROLLER_RESERVE) - counting active
// CLAIM parts on either side is the whole basis for deciding who's winning a reservation
// contest, not just how many reserver creeps exist.
function countActiveClaimParts(body: BodyPartDefinition[]): number {
  return body.filter((part) => part.type === CLAIM && part.hits > 0).length;
}

// Requires live vision into the remote room, same as buildRemoteSourceState - defaults to
// 0 when it isn't visible, since an unseen rival reservation can't be measured and treating
// it as 0 pressure is the same "no vision -> assume uncontested" convention used elsewhere
// in this file.
function countHostileReservationClaimParts(remoteRoomName: string): number {
  const remoteRoom = Game.rooms[remoteRoomName];
  if (!remoteRoom) return 0;

  return getCachedFind(remoteRoom, FIND_HOSTILE_CREEPS).reduce(
    (sum, hostile) => sum + countActiveClaimParts(hostile.body),
    0
  );
}

// A creep with no live ATTACK or RANGED_ATTACK part can't hurt a defender - counting it
// toward the defender target would waste spawns matching numbers against, say, a rival's
// unarmed remoteHarvester or reserver rather than the actual threat.
function hasActiveCombatPart(body: BodyPartDefinition[]): boolean {
  return body.some((part) => (part.type === ATTACK || part.type === RANGED_ATTACK) && part.hits > 0);
}

// Same "requires live vision, defaults to 0" convention as countHostileReservationClaimParts.
function countHostileCombatCreeps(remoteRoomName: string): number {
  const remoteRoom = Game.rooms[remoteRoomName];
  if (!remoteRoom) return 0;

  return getCachedFind(remoteRoom, FIND_HOSTILE_CREEPS).filter((hostile) =>
    hasActiveCombatPart(hostile.body)
  ).length;
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
  const remoteMemory = Memory.rooms[remoteRoomName];
  const lastHostileSeenTick = remoteMemory?.lastHostileSeenTick;

  let reserverCount = 0;
  let ourReserverClaimParts = 0;
  let remoteHarvesterCount = 0;
  let remoteHaulerCount = 0;
  const minerSourceIds = new Set<Id<Source>>();
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.remoteRoom !== remoteRoomName) continue;
    if (creep.memory.role === "reserver") {
      // Unlike every local role (see spawnManager.ts's preSpawnLeadTimeByRole), remote
      // roles had no anticipatory replacement at all - a reserver counted fully right up
      // to the tick it died, so a replacement only started spawning (and then traveling)
      // once a real gap had already opened, sometimes with reservation/vision already
      // lapsed by the time it arrived. Treating a reserver as "already gone" once it's
      // within its own replacement's spawn+travel time mirrors the local convention:
      // decideNextRemoteSpawn sees the deficit and queues a replacement while the dying
      // one is still there defending, so the two overlap instead of leaving a gap.
      const nearingDeath = isNearingDeath(
        creep.ticksToLive,
        replacementLeadTime(creep.body.length, RESERVER_TRAVEL_ESTIMATE)
      );
      if (!nearingDeath) {
        reserverCount++;
        ourReserverClaimParts += countActiveClaimParts(creep.body);
      }
    }
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
    ownedByOther: isRoomOwnedByOther(remoteMemory?.remoteIntel),
    reserverCount,
    ourReserverClaimParts,
    hostileReservationClaimParts: countHostileReservationClaimParts(remoteRoomName),
    hostileCombatCreepCount: countHostileCombatCreeps(remoteRoomName),
    remoteHarvesterCount,
    remoteHaulerCount,
    ...buildRemoteSourceState(remoteRoomName, minerSourceIds),
    energyAvailable: homeRoom.energyAvailable,
    energyCapacityAvailable: homeRoom.energyCapacityAvailable
  };
}

// One colonizer at a time is plenty - it only needs to get a single spawn site built
// (see roomPlanner.ts's planSpawn), not run an ongoing economy. Once the spawn
// completes, main.ts's generic per-spawn pipeline takes over on its own.
const COLONIZER_TARGET = 1;

function countLiveColonizers(remoteRoomName: string): number {
  let count = 0;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.remoteRoom === remoteRoomName && creep.memory.role === "colonizer") count++;
  }
  return count;
}

// Two triggers: once a remote room has actually been claimed (controller.my) - claiming
// itself is reserver.ts's job (see RoomMemory.claimTarget) - this fires because a claimed
// room has a controller but no spawn, and nothing else in the codebase places or builds
// one on its own (see roomPlanner.ts's planSpawn). But waiting for that would mean the
// colonizer only starts traveling *after* the claim lands, when reserver.ts claims the
// same tick GCL allows it - all of the travel time would land inside the vulnerable
// spawnless window instead of being absorbed ahead of it. So it also fires pre-claim,
// once this room is the designated claim target and isClaimWindowApproaching() says GCL
// is close enough that it's worth a creep getting into position now - by the time the
// claim actually lands, it's already there, fed, and ready to build the instant
// planSpawn places a site.
function decideColonizerSpawn(state: RemoteRoomState): SpawnDecision | null {
  const remoteRoom = Game.rooms[state.remoteRoomName];
  const isOwned = remoteRoom?.controller?.my ?? false;

  if (isOwned) {
    if (getCachedFind(remoteRoom, FIND_MY_SPAWNS).length > 0) return null;
  } else {
    const claimTarget = Memory.rooms[state.homeRoomName]?.claimTarget;
    const isPreClaimWindow = claimTarget === state.remoteRoomName && isClaimWindowApproaching();
    // Also fires whenever the room has unbuilt sites sitting idle (e.g. a decayed
    // container's replacement, or a manually-queued road), independent of claim timing -
    // remoteHarvester's own container-building duty only runs while a remoteHarvester is
    // actually alive, and it ages out once a source's container completes, so nothing
    // re-triggers it if that container is later destroyed and sourcesWithoutContainerCount
    // ticks back up to 1 - the round-robin further down *should* eventually catch it, but
    // an active reservation contest can dominate every spawn cycle for a long stretch
    // (see MAX_RESERVER_CLAIM_PARTS's own comment on why that's accepted, not prevented).
    // A colonizer gives this a second, independent path to getting built.
    const hasUnbuiltSites =
      remoteRoom !== undefined && getCachedFind(remoteRoom, FIND_CONSTRUCTION_SITES).length > 0;
    if (!isPreClaimWindow && !hasUnbuiltSites) return null;
  }

  if (countLiveColonizers(state.remoteRoomName) >= COLONIZER_TARGET) return null;

  const body = planBody("colonizer", state.energyCapacityAvailable);
  if (body.length === 0 || bodyCost(body) > state.energyAvailable) return null;

  return {
    role: "colonizer",
    body,
    memory: { homeRoom: state.homeRoomName, remoteRoom: state.remoteRoomName }
  };
}

// A flat target of 1 assumed ender2012's historically unarmed CLAIM+MOVE presence - that
// assumption broke live: W57N24 took a two-skirmisher assault (4 TOUGH/12 MOVE/8 ATTACK,
// 2400 HP each). A single max-body defender (13 ATTACK/13 MOVE at 1800 capacity, 2600 HP,
// 390 DPS) wins 1-on-1 (6.15 ticks to kill a 2400 HP skirmisher vs 10.8 to die to its 240
// DPS), but loses when both skirmishers attack it at once: their combined 480 DPS kills
// our defender (2600 HP) in 5.4 ticks, faster than its 390 DPS can kill either one (6.15
// ticks). Scaling to the live combat headcount, same "rival's count + 1" margin
// MAX_RESERVER_CLAIM_PARTS's comment explains for reservation contests, guarantees an
// actual numbers advantage rather than a race that can go either way - at 3-on-2, our
// combined 1170 DPS drops one skirmisher in ~2.05 ticks (they've dealt at most ~985
// combined damage back by then, well under any single defender's 2600 HP), then mops up
// the second 2-on-1. Capped so an escalating rival can't turn this into an unbounded
// spawn sink, same rationale as MAX_RESERVER_CLAIM_PARTS.
const REMOTE_DEFENDER_TARGET_CAP = 4;

function remoteDefenderTargetFor(state: RemoteRoomState): number {
  return Math.min(state.hostileCombatCreepCount + 1, REMOTE_DEFENDER_TARGET_CAP);
}

function countLiveRemoteDefenders(remoteRoomName: string): number {
  let count = 0;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.remoteRoom === remoteRoomName && creep.memory.role === "defender") count++;
  }
  return count;
}

// Once owned, maintained unconditionally (no isClaimWindowApproaching or spawn-exists
// off-switch the way decideColonizerSpawn's post-claim branch has) - the goal is
// sustained control over "a large sustained period of ticks", not just surviving the
// moment of claiming. Deliberately NOT keyed on isClaimWindowApproaching once owned:
// that function measures GCL readiness for the *next* room, which naturally goes false
// again shortly after this one is claimed (ownedRoomCount catches up to gcl.level, and
// progress resets toward a much larger next threshold) - reusing it here would silently
// stand the defender down right after a successful claim, the opposite of the goal.
// Pre-claim, still gated on isClaimWindowApproaching so it doesn't fire on a whim long
// before GCL is anywhere close (a bit early is cheap - an idle creep - but not free).
function decideRemoteDefenderSpawn(state: RemoteRoomState): SpawnDecision | null {
  const claimTarget = Memory.rooms[state.homeRoomName]?.claimTarget;
  if (claimTarget !== state.remoteRoomName) return null;

  const isOwned = Game.rooms[state.remoteRoomName]?.controller?.my ?? false;
  if (!isOwned && !isClaimWindowApproaching()) return null;

  if (countLiveRemoteDefenders(state.remoteRoomName) >= remoteDefenderTargetFor(state)) return null;

  const body = planBody("defender", state.energyCapacityAvailable);
  if (body.length === 0 || bodyCost(body) > state.energyAvailable) return null;

  return {
    role: "defender",
    body,
    memory: { homeRoom: state.homeRoomName, remoteRoom: state.remoteRoomName }
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
  if (state.ownedByOther) return null;

  // Checked ahead of the hostileRecentlySeen gate below, deliberately: every other
  // remote spawn decision pauses when a hostile's been seen recently (an unarmed economy
  // creep walking into danger is a straightforward loss - see roles/shared.ts's
  // retreatFromHostileRemote), but a defender's whole purpose is to walk into that same
  // danger and fight it. Gating it behind "no hostile recently seen" would block it
  // exactly when it's most needed.
  const defenderDecision = decideRemoteDefenderSpawn(state);
  if (defenderDecision) return defenderDecision;

  if (state.hostileRecentlySeen) return null;

  // A room we already own has no reservation to contest - reserveController/
  // attackController against our own controller is a no-op at best (reserver.ts's own
  // `if (controller.my) return;` guard) and this block would otherwise keep sizing a
  // reserver body against a rival's CLAIM part count forever, purely because a hostile
  // reserver happens to be standing in the room. That would compete with the colonizer
  // (below) for every spawn slot once the room is cleared - exactly the resource this
  // room most needs directed at finishing its first spawn instead.
  const isOwnedByUs = Game.rooms[state.remoteRoomName]?.controller?.my ?? false;
  if (!isOwnedByUs) {
    // "Enough reserver" isn't a headcount, it's a CLAIM-part tally: attackController and
    // reserveController both move a controller's reservation endTime by 1 tick per CLAIM
    // part per tick, symmetric for whoever's contesting it, so a rival fielding more CLAIM
    // parts than our lone reserver simply out-reserves it forever no matter how long it
    // sits there (found live in W57N24 - a 1-CLAIM reserver never even dented a 2-CLAIM
    // rival's reservation). Sizing to exactly one more than the rival's current CLAIM count
    // is the minimum body that actually reverses the reservation's direction instead of just
    // slowing its growth - but only up to MAX_RESERVER_CLAIM_PARTS (see its own comment):
    // an escalating rival must not turn this into an unbounded energy sink.
    const neededClaimParts = state.hostileReservationClaimParts + 1;
    const targetClaimParts = Math.min(neededClaimParts, MAX_RESERVER_CLAIM_PARTS);
    if (state.ourReserverClaimParts < targetClaimParts) {
      const body = planReserverBody(targetClaimParts - state.ourReserverClaimParts);
      if (bodyCost(body) <= state.energyAvailable) {
        return {
          role: "reserver",
          body,
          memory: { homeRoom: state.homeRoomName, remoteRoom: state.remoteRoomName }
        };
      }
      // Only hard-block behind an unaffordable reinforcement when there's no reserver
      // presence at all - vision/reservation has to come from somewhere first. An
      // established room that already has a reserver out there but just can't afford (or
      // has capped out) its next top-up shouldn't have miner/remoteHarvester/remoteHauler
      // starved behind a reservation fight it's already chosen not to keep escalating -
      // found live: W57N24's contest alone drove 241 reserver spawns over ~174k ticks
      // while remoteHauler sat at zero population 63% of that time, because this used to
      // return null unconditionally here regardless of whether a reserver already existed.
      if (state.reserverCount === 0) return null;
    }
  }

  const colonizerDecision = decideColonizerSpawn(state);
  if (colonizerDecision) return colonizerDecision;

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
    { role: "remoteHauler", count: state.remoteHaulerCount, target: remoteHaulerTarget(state) }
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
// needs for spawn time. That gate, and decideNextSpawn's own defender pre-empts ahead of
// it, are untouched by everything below - scouting can only ever cede ground within the
// remote-spawning slice of priority, never home-room economy or defense.
export function decideRemoteSpawn(room: Room): SpawnDecision | null {
  Memory.rooms[room.name] = Memory.rooms[room.name] || {};
  const homeMemory = Memory.rooms[room.name];

  const resolvedRooms = homeMemory.remoteRooms ?? [];
  const states = resolvedRooms.map((remoteRoomName) => buildRemoteRoomState(room, remoteRoomName));

  // Short-circuit before touching Game.map or rescanning candidate memory at all once at
  // cap - this room will never need a new target again.
  const candidateMemories: Record<string, RoomMemory | undefined> = {};
  if (resolvedRooms.length < MAX_REMOTE_ROOMS) {
    const candidates = getRemoteCandidates(room.name).filter(
      (candidate) => !resolvedRooms.includes(candidate)
    );
    for (const candidate of candidates) {
      candidateMemories[candidate] = Memory.rooms[candidate];
    }

    // Scouting an unscouted candidate jumps ahead of *every* resolved room's own
    // restaffing - not just the round-robin below, but also the unbootstrapped pre-empt
    // right after this block. Found live: W57N24 sits in a sustained reservation contest
    // (rival out-reserving us via attackController, see reserver.ts), so its reserver
    // dies and gets replaced often enough that reserverCount genuinely hits 0 on a
    // recurring share of ticks - not just the one-off "freshly resolved" case the
    // bootstrap pre-empt was written for. That pre-empt has no way to tell "never
    // bootstrapped" apart from "established room, reserver just died again", so it kept
    // re-claiming the slot on every such dip: W59N25 went 20,000+ ticks unscouted even
    // after the round-robin fix below (4826095) shipped, because the contest never let
    // reserverCount stay above 0 long enough for execution to ever reach that fix. A
    // scout is one MOVE part (50E) and self-limits to one at a time (decideScoutSpawn's
    // liveScoutTargets check), so ceding a handful of spawn slots to it - fresh room or
    // not - is a bounded, cheap cost. See this function's own top comment for why that
    // cost never reaches home-room economy or defense.
    const liveScoutTargets = new Set(
      Object.values(Game.creeps)
        .filter((creep) => creep.memory.role === "scout")
        .map((creep) => creep.memory.remoteRoom)
        .filter((remoteRoom): remoteRoom is string => remoteRoom !== undefined)
    );
    const scoutDecision = decideScoutSpawn(room.name, candidates, candidateMemories, liveScoutTargets);
    if (scoutDecision) return scoutDecision;
  }

  // A freshly-resolved room with zero reservers hasn't been staffed at all yet - it
  // jumps ahead of every other resolved room's routine restaffing, mirroring
  // decideNextRemoteSpawn's own "no reserver yet" unconditional pre-empt within a single
  // room. Without this, strict list order below would let room 1's endless one-off
  // replacement spawns starve a from-scratch room 2 indefinitely, since room 1 will
  // almost always have *some* affordable need on any given tick.
  const unbootstrapped = states.find((state) => state.reserverCount === 0);
  if (unbootstrapped) {
    const decision = decideNextRemoteSpawn(unbootstrapped);
    if (decision) return decision;
  }

  // Deliberate v1 simplification, not full round-robin fairness: room 1's outstanding
  // need beats room 2's. The one case where that actually bites (a from-scratch room 2)
  // is already covered by the bootstrap pre-empt above.
  for (const state of states) {
    const decision = decideNextRemoteSpawn(state);
    if (decision) return decision;
  }

  if (resolvedRooms.length >= MAX_REMOTE_ROOMS) return null;

  const newRemoteRoomName = resolveNextRemoteRoom(room.name, homeMemory, candidateMemories);
  if (newRemoteRoomName) {
    return decideNextRemoteSpawn(buildRemoteRoomState(room, newRemoteRoomName));
  }

  return null;
}
