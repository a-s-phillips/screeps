import { runWithErrorLogging } from "./logging/errorHandler";
import { detectNewHostiles } from "./logging/hostiles";
import { checkLevelUp } from "./logging/levelUp";
import { flushLogBuffer, log } from "./logging/logger";
import { buildCpuSummary, buildTickSummary } from "./logging/tickSummary";
import { cleanUpDeadCreepMemory } from "./memory/cleanup";
import { run as runBuilder } from "./roles/builder";
import { run as runHarvester } from "./roles/harvester";
import { run as runUpgrader } from "./roles/upgrader";
import { runSpawning } from "./spawn/spawnManager";
import { getCachedFind, resetRoomCache } from "./utils/roomCache";

const roleRunners: Record<CreepRole, (creep: Creep) => void> = {
  harvester: runHarvester,
  upgrader: runUpgrader,
  builder: runBuilder
};

let seenHostileIds = new Set<string>();

export function loop(): void {
  runWithErrorLogging(() => {
    resetRoomCache();
    Memory.rooms = Memory.rooms || {};
    cleanUpDeadCreepMemory(Memory, Game.creeps);

    for (const spawnName in Game.spawns) {
      const spawn = Game.spawns[spawnName];
      runSpawning(spawn, spawn.room);
    }

    for (const creepName in Game.creeps) {
      const creep = Game.creeps[creepName];
      roleRunners[creep.memory.role](creep);
    }

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];

      const hostiles = getCachedFind(room, FIND_HOSTILE_CREEPS);
      const { sightings, seenIds } = detectNewHostiles(hostiles, seenHostileIds);
      seenHostileIds = seenIds;
      for (const sighting of sightings) {
        log("hostile_sighted", sighting);
      }

      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      const levelUp = checkLevelUp(room, Memory.rooms[roomName]);
      if (levelUp) log("level_up", levelUp);
    }

    log("tick_summary", {
      rooms: buildTickSummary(Object.values(Game.rooms), Game.creeps),
      cpu: buildCpuSummary(Game.cpu)
    });
  });

  flushLogBuffer();
}
