import { isKeeperWindowReachable } from "../planning/keeperTargeting";
import { bodyCost, planBody } from "./bodyPlanner";
import { replacementLeadTime } from "./preSpawn";
import { SpawnDecision } from "./spawnDecision";

// A target set of one doesn't need a candidate-picking pipeline the way normal remote
// rooms do - this is a deliberate, manually-chosen one-off, not something the bot
// auto-expands into repeatedly.
//
// Raised from 1 once live observation confirmed the room's lairs are phase-synced (see
// project notes): the safe window is a single ~200-300 tick burst with every source open
// at once, not a staggered rotation, so several creeps arriving together get far more
// use out of a window than a standing population of one that mostly sits out the
// guarded phase anyway.
const KEEPER_HARVESTER_TARGET = 3;

// Unverified estimate, same tuning caveat as keeperTargeting's constants - the SK room
// is a single adjacent room in the observed deployment; refine once a real spawn-to-
// source path length is known for whichever room keeperRoom points at.
const KEEPER_ROOM_TRAVEL_ESTIMATE = 50;

export function decideKeeperSpawn(room: Room): SpawnDecision | null {
  const keeperRoomName = Memory.rooms[room.name]?.keeperRoom;
  if (!keeperRoomName) return null;

  const count = Object.values(Game.creeps).filter(
    (creep) => creep.memory.role === "keeperHarvester" && creep.memory.remoteRoom === keeperRoomName
  ).length;
  if (count >= KEEPER_HARVESTER_TARGET) return null;

  const body = planBody("keeperHarvester", room.energyCapacityAvailable);
  if (body.length === 0 || bodyCost(body) > room.energyAvailable) return null;

  // Gate on whether the next safe window falls within this creep's reachable lifetime -
  // found live: with no timing check at all, three keeperHarvesters in a row spawned
  // mid-guarded-phase and died of old age without ever harvesting a single tick of
  // energy, because spawning happened completely independent of the lair timers.
  const arrivalOffset = replacementLeadTime(body.length, KEEPER_ROOM_TRAVEL_ESTIMATE);
  const intel = Memory.rooms[keeperRoomName]?.keeperIntel;
  if (!isKeeperWindowReachable(intel, Game.time, arrivalOffset)) return null;

  return {
    role: "keeperHarvester",
    body,
    memory: { homeRoom: room.name, remoteRoom: keeperRoomName }
  };
}
