import { travelToRoom } from "./shared";

export function run(creep: Creep): void {
  const remoteRoom = creep.memory.remoteRoom;
  if (!remoteRoom) return;

  travelToRoom(creep, remoteRoom);
}
