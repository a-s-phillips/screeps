export function cleanUpDeadCreepMemory(memory: Memory, creeps: { [name: string]: Creep }): void {
  for (const name in memory.creeps) {
    if (!(name in creeps)) {
      delete memory.creeps[name];
    }
  }
}
