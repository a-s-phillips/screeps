import { bodyCost, planBody } from "./bodyPlanner";
import { SpawnDecision } from "./spawnDecision";

// A target set of one doesn't need a candidate-picking pipeline the way normal remote
// rooms do - this is a deliberate, manually-chosen one-off, not something the bot
// auto-expands into repeatedly.
const KEEPER_HARVESTER_TARGET = 1;

export function decideKeeperSpawn(room: Room): SpawnDecision | null {
  const keeperRoomName = Memory.rooms[room.name]?.keeperRoom;
  if (!keeperRoomName) return null;

  const count = Object.values(Game.creeps).filter(
    (creep) => creep.memory.role === "keeperHarvester" && creep.memory.remoteRoom === keeperRoomName
  ).length;
  if (count >= KEEPER_HARVESTER_TARGET) return null;

  const body = planBody("keeperHarvester", room.energyCapacityAvailable);
  if (body.length === 0 || bodyCost(body) > room.energyAvailable) return null;

  return {
    role: "keeperHarvester",
    body,
    memory: { homeRoom: room.name, remoteRoom: keeperRoomName }
  };
}
