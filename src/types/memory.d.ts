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
    | "defender"
    | "keeperHarvester";

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
    // Manually set, not auto-resolved like remoteRooms - a Source Keeper avoidance-mining
    // target is a deliberate one-off strategic choice, not something worth a whole
    // candidate-picking pipeline for. Deliberately excluded from buildRemoteTargets in
    // main.ts, since v1 keeperHarvester is self-hauling only and should never get a
    // container planned for it.
    keeperRoom?: string;
  }
}

export {};
