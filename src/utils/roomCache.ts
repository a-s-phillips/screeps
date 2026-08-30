const cache = new Map<string, unknown[]>();

export function resetRoomCache(): void {
  cache.clear();
}

export function getCachedFind<K extends FindConstant>(room: Room, type: K): Array<FindTypes[K]> {
  const key = `${room.name}:${type}`;
  const cached = cache.get(key);
  if (cached) return cached as Array<FindTypes[K]>;

  const found = room.find(type);
  cache.set(key, found);
  return found;
}
