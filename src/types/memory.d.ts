declare global {
  type CreepRole = "harvester" | "upgrader" | "builder" | "hauler" | "miner";

  interface CreepMemory {
    role: CreepRole;
    working: boolean;
    sourceId?: Id<Source>;
  }

  interface RoomMemory {
    lastKnownRCL?: number;
    roadPlan?: { x: number; y: number }[];
    lastHostileSeenTick?: number;
  }
}

export {};
