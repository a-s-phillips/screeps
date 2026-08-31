import { flushLogBuffer, log } from "./logging/logger";
import { buildTickSummary } from "./logging/tickSummary";
import { cleanUpDeadCreepMemory } from "./memory/cleanup";
import { run as runBuilder } from "./roles/builder";
import { run as runHarvester } from "./roles/harvester";
import { run as runUpgrader } from "./roles/upgrader";
import { runSpawning } from "./spawn/spawnManager";
import { resetRoomCache } from "./utils/roomCache";

const roleRunners: Record<CreepRole, (creep: Creep) => void> = {
  harvester: runHarvester,
  upgrader: runUpgrader,
  builder: runBuilder
};

export function loop(): void {
  resetRoomCache();
  cleanUpDeadCreepMemory(Memory, Game.creeps);

  for (const spawnName in Game.spawns) {
    const spawn = Game.spawns[spawnName];
    runSpawning(spawn, spawn.room);
  }

  for (const creepName in Game.creeps) {
    const creep = Game.creeps[creepName];
    roleRunners[creep.memory.role](creep);
  }

  log("tick_summary", { rooms: buildTickSummary(Object.values(Game.rooms), Game.creeps) });
  flushLogBuffer();
}
