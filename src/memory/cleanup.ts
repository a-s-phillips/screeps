import { log } from "../logging/logger";

export function cleanUpDeadCreepMemory(memory: Memory, creeps: { [name: string]: Creep }): void {
  for (const name in memory.creeps) {
    if (!(name in creeps)) {
      log("creep_died", {
        role: memory.creeps[name].role,
        name,
        room: memory.creeps[name].homeRoom
      });
      delete memory.creeps[name];
    }
  }
}
