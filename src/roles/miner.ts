import { findContainerAtSource, MOVE_OPTS, retreatFromHostileRemote } from "./shared";

export function run(creep: Creep): void {
  const sourceId = creep.memory.sourceId;
  if (!sourceId) return;

  // Only set for a remote miner (see remoteSpawnManager.ts) - undefined for every local
  // miner, so this is a no-op there.
  const remoteRoom = creep.memory.remoteRoom;
  if (remoteRoom && retreatFromHostileRemote(creep, remoteRoom, creep.memory.homeRoom)) return;

  const source = Game.getObjectById(sourceId);
  if (!source) return;

  const container = findContainerAtSource(source);
  if (!container) return;

  if (creep.pos.x !== container.pos.x || creep.pos.y !== container.pos.y) {
    creep.moveTo(container, MOVE_OPTS);
  }

  creep.harvest(source);
}
