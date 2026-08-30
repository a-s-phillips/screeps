declare global {
  type CreepRole = "harvester" | "upgrader" | "builder";

  interface CreepMemory {
    role: CreepRole;
    working: boolean;
  }
}

export {};
