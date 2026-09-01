declare global {
  type CreepRole = "harvester" | "upgrader" | "builder" | "hauler";

  interface CreepMemory {
    role: CreepRole;
    working: boolean;
  }

  interface RoomMemory {
    lastKnownRCL?: number;
    roadPlan?: { x: number; y: number }[];
  }
}

export {};
