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
    // Set on retreat from a Source Keeper room, cleared once it expires - prevents
    // immediately turning back around next tick (see keeperHarvester.ts), which
    // otherwise thrashes the creep back and forth across the room border for its whole
    // remaining life without ever getting a real chance to wait out an unsafe window.
    keeperRetreatUntil?: number;
  }

  interface RemoteIntel {
    sourceCount: number;
    ownedByOther: boolean;
    reservedByOther: boolean;
    hasSourceKeeper: boolean;
  }

  interface KeeperIntel {
    // Absolute Game.time a currently-open safe window closes at (a live guard is due to
    // respawn), or null if every lair currently has a live guard with no visible
    // countdown at all. Only ever written while the bot has vision into the room (see
    // recordKeeperIntel in planning/keeperTargeting.ts) - stays frozen at its last
    // observed value once vision is lost, same tradeoff recordRemoteIntel already makes.
    nextWindowCloseTick: number | null;
    observedAt: number;
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
    keeperIntel?: KeeperIntel;
  }
}

export {};
