export interface RoomSummary {
  room: string;
  energyAvailable: number;
  energyCapacityAvailable: number;
  creepCount: number;
}

export function buildTickSummary(rooms: Room[], creeps: { [name: string]: Creep }): RoomSummary[] {
  const creepList = Object.values(creeps);

  return rooms.map((room) => ({
    room: room.name,
    energyAvailable: room.energyAvailable,
    energyCapacityAvailable: room.energyCapacityAvailable,
    creepCount: creepList.filter((creep) => creep.room.name === room.name).length
  }));
}
