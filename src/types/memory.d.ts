declare global {
  type CreepRole =
    | "harvester"
    | "upgrader"
    | "builder"
    | "hauler"
    | "miner"
    | "scout"
    | "reserver"
    | "remoteHarvester"
    | "remoteHauler"
    | "defender";

  interface CreepMemory {
    role: CreepRole;
    working: boolean;
    sourceId?: Id<Source>;
    homeRoom?: string;
    remoteRoom?: string;
  }

  interface RemoteIntel {
    sourceCount: number;
    ownedByOther: boolean;
    reservedByOther: boolean;
    hasSourceKeeper: boolean;
  }

  interface RoomMemory {
    lastKnownRCL?: number;
    roadPlan?: { x: number; y: number }[];
    lastHostileSeenTick?: number;
    remoteIntel?: RemoteIntel;
    remoteRooms?: string[];
  }
}

export {};
