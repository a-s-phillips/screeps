export interface LevelUpEvent {
  room: string;
  from: number;
  to: number;
}

export function checkLevelUp(room: Room, roomMemory: RoomMemory): LevelUpEvent | null {
  const level = room.controller?.level;
  if (level === undefined) return null;

  const previous = roomMemory.lastKnownRCL;
  roomMemory.lastKnownRCL = level;

  if (previous !== undefined && level > previous) {
    return { room: room.name, from: previous, to: level };
  }

  return null;
}
