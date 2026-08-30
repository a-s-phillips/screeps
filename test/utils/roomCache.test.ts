import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedFind, resetRoomCache } from "../../src/utils/roomCache";

function mockRoom(name: string) {
  return {
    name,
    find: vi.fn().mockReturnValue([])
  } as unknown as Room;
}

describe("getCachedFind", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("only calls room.find once for repeated calls with the same room and type", () => {
    const room = mockRoom("W1N1");

    getCachedFind(room, FIND_SOURCES);
    getCachedFind(room, FIND_SOURCES);
    getCachedFind(room, FIND_SOURCES);

    expect(room.find).toHaveBeenCalledTimes(1);
    expect(room.find).toHaveBeenCalledWith(FIND_SOURCES);
  });

  it("calls room.find separately for different find types on the same room", () => {
    const room = mockRoom("W1N1");

    getCachedFind(room, FIND_SOURCES);
    getCachedFind(room, FIND_CONSTRUCTION_SITES);

    expect(room.find).toHaveBeenCalledTimes(2);
  });

  it("calls room.find separately for the same type on different rooms", () => {
    const roomA = mockRoom("W1N1");
    const roomB = mockRoom("W2N2");

    getCachedFind(roomA, FIND_SOURCES);
    getCachedFind(roomB, FIND_SOURCES);

    expect(roomA.find).toHaveBeenCalledTimes(1);
    expect(roomB.find).toHaveBeenCalledTimes(1);
  });

  it("re-queries after resetRoomCache is called", () => {
    const room = mockRoom("W1N1");

    getCachedFind(room, FIND_SOURCES);
    resetRoomCache();
    getCachedFind(room, FIND_SOURCES);

    expect(room.find).toHaveBeenCalledTimes(2);
  });
});
