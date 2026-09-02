export interface RoomSummary {
  room: string;
  energyAvailable: number;
  energyCapacityAvailable: number;
  creepCount: number;
}

export interface CpuSummary {
  used: number;
  bucket: number;
}

export function buildCpuSummary(cpu: CPU): CpuSummary {
  return { used: cpu.getUsed(), bucket: cpu.bucket };
}

// A remote-mining creep's creep.room.name toggles between its home room and the remote
// room as it travels; counting raw physical presence turned this into a square wave
// (found live: creep count alternating almost every sample between two values) instead
// of a stable population trend. Attribute by memory.homeRoom when set - falls back to
// current room for every local-only role, which never leaves it in the first place.
export function buildTickSummary(rooms: Room[], creeps: { [name: string]: Creep }): RoomSummary[] {
  const creepList = Object.values(creeps);

  return rooms.map((room) => ({
    room: room.name,
    energyAvailable: room.energyAvailable,
    energyCapacityAvailable: room.energyCapacityAvailable,
    creepCount: creepList.filter(
      (creep) => (creep.memory.homeRoom ?? creep.room.name) === room.name
    ).length
  }));
}
