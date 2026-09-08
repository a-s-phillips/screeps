import { getCachedFind } from "../utils/roomCache";

export interface DoctrineRevertEvent {
  room: string;
  claimTarget: string;
}

// "colonize" doctrine (see RoomMemory.doctrine) is otherwise a manual toggle - entering
// it, or leaving it early, is a deliberate Memory edit. But it has one built-in exit
// condition: once the claim target's own spawn actually exists, the thing spawn priority
// was being freed up for is done, and staying in "colonize" would just slow-roll RCL
// growth for no further benefit. Checked against the claim target's spawn, not its
// controller ownership - a claim can land well before the spawn colonizer.ts is building
// there actually completes (see decideColonizerSpawn's post-claim branch in
// remoteSpawnManager.ts), and that gap is exactly the window "colonize" exists to help
// with.
export function checkColonizeDoctrineComplete(
  homeRoomName: string,
  homeMemory: RoomMemory
): DoctrineRevertEvent | null {
  if (homeMemory.doctrine !== "colonize" || !homeMemory.claimTarget) return null;

  const claimRoom = Game.rooms[homeMemory.claimTarget];
  if (!claimRoom || getCachedFind(claimRoom, FIND_MY_SPAWNS).length === 0) return null;

  const event: DoctrineRevertEvent = { room: homeRoomName, claimTarget: homeMemory.claimTarget };
  homeMemory.doctrine = "econ";
  return event;
}
