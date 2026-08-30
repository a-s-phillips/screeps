import { cleanUpDeadCreepMemory } from "./memory/cleanup";

export function loop(): void {
  cleanUpDeadCreepMemory(Memory, Game.creeps);
}
