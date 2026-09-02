import { runWithErrorLogging } from "./logging/errorHandler";
import { detectNewHostiles, recordHostileSighting } from "./logging/hostiles";
import { checkLevelUp } from "./logging/levelUp";
import { flushLogBuffer, log } from "./logging/logger";
import { buildCpuSummary, buildTickSummary } from "./logging/tickSummary";
import { cleanUpDeadCreepMemory } from "./memory/cleanup";
import { recordRemoteIntel } from "./planning/remoteTargeting";
import { planRoom } from "./planning/roomPlanner";
import { run as runBuilder } from "./roles/builder";
import { run as runDefender } from "./roles/defender";
import { run as runHarvester } from "./roles/harvester";
import { run as runHauler } from "./roles/hauler";
import { run as runKeeperHarvester } from "./roles/keeperHarvester";
import { run as runMiner } from "./roles/miner";
import { run as runRemoteHarvester } from "./roles/remoteHarvester";
import { run as runRemoteHauler } from "./roles/remoteHauler";
import { run as runReserver } from "./roles/reserver";
import { run as runScout } from "./roles/scout";
import { run as runUpgrader } from "./roles/upgrader";
import { runSpawning } from "./spawn/spawnManager";
import { run as runTower } from "./structures/tower";
import { getCachedFind, resetRoomCache } from "./utils/roomCache";

const roleRunners: Record<CreepRole, (creep: Creep) => void> = {
  harvester: runHarvester,
  upgrader: runUpgrader,
  builder: runBuilder,
  hauler: runHauler,
  miner: runMiner,
  scout: runScout,
  reserver: runReserver,
  remoteHarvester: runRemoteHarvester,
  remoteHauler: runRemoteHauler,
  defender: runDefender,
  keeperHarvester: runKeeperHarvester
};

let seenHostileIds = new Set<string>();

// Extracted from loop() for testability - flattens every owned room's remoteRooms list
// into one set, since a room can now be *some* home room's remote target without being
// the only one, or the only remote room that home room has.
export function buildRemoteTargets(
  ownedRooms: Room[],
  memoryRooms: Record<string, RoomMemory | undefined>
): Set<string> {
  return new Set(ownedRooms.flatMap((room) => memoryRooms[room.name]?.remoteRooms ?? []));
}

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

    const remoteTargets = buildRemoteTargets(
      Object.values(Game.rooms).filter((room) => room.controller?.my),
      Memory.rooms
    );

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];

      const hostiles = getCachedFind(room, FIND_HOSTILE_CREEPS);
      const { sightings, seenIds } = detectNewHostiles(hostiles, seenHostileIds);
      seenHostileIds = seenIds;
      for (const sighting of sightings) {
        log("hostile_sighted", sighting);
      }

      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      recordHostileSighting(Memory.rooms[roomName], hostiles);
      const levelUp = checkLevelUp(room, Memory.rooms[roomName]);
      if (levelUp) log("level_up", levelUp);

      // Overwritten every tick while visible, so it's ready the moment a remote-mining
      // candidate is scouted - recorded for every visible room, not just chosen targets.
      recordRemoteIntel(room, Memory.rooms[roomName]);

      const towers = getCachedFind(room, FIND_MY_STRUCTURES).filter(
        (structure): structure is StructureTower => structure.structureType === STRUCTURE_TOWER
      );
      for (const tower of towers) runTower(tower);

      planRoom(
        room,
        Memory.rooms[roomName],
        (room.controller?.my ?? false) || remoteTargets.has(roomName)
      );
    }

    log("tick_summary", {
      rooms: buildTickSummary(Object.values(Game.rooms), Game.creeps),
      cpu: buildCpuSummary(Game.cpu)
    });
  });

  flushLogBuffer();
}
