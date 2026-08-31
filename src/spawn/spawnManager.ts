import { log } from "../logging/logger";
import { getCachedFind } from "../utils/roomCache";
import { planBody } from "./bodyPlanner";

export interface RoomState {
  creepCounts: Record<CreepRole, number>;
  activeSourceCount: number;
  constructionSiteCount: number;
  energyAvailable: number;
}

interface SpawnDecision {
  role: CreepRole;
  body: BodyPartConstant[];
}

export function decideNextSpawn(state: RoomState): SpawnDecision | null {
  const targets: { role: CreepRole; target: number }[] = [
    { role: "harvester", target: state.activeSourceCount * 2 },
    { role: "upgrader", target: 2 },
    { role: "builder", target: state.constructionSiteCount > 0 ? 2 : 0 }
  ];

  for (const { role, target } of targets) {
    if (state.creepCounts[role] >= target) continue;

    const body = planBody(role, state.energyAvailable);
    if (body.length > 0) return { role, body };
  }

  return null;
}

export function runSpawning(spawn: StructureSpawn, room: Room): void {
  if (spawn.spawning) return;

  const creepCounts: Record<CreepRole, number> = { harvester: 0, upgrader: 0, builder: 0 };
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name === room.name) {
      creepCounts[creep.memory.role]++;
    }
  }

  const state: RoomState = {
    creepCounts,
    activeSourceCount: getCachedFind(room, FIND_SOURCES_ACTIVE).length,
    constructionSiteCount: getCachedFind(room, FIND_CONSTRUCTION_SITES).length,
    energyAvailable: room.energyAvailable
  };

  const decision = decideNextSpawn(state);
  if (!decision) return;

  const name = `${decision.role}_${Game.time}`;
  const result = spawn.spawnCreep(decision.body, name, {
    memory: { role: decision.role, working: false }
  });

  if (result === OK) {
    log("spawn", { role: decision.role, name });
  }
}
