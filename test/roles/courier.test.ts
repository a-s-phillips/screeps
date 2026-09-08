import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/courier";
import { MOVE_OPTS, REMOTE_MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const spawn = { id: "spawn1", structureType: STRUCTURE_SPAWN };

function mockCreep(opts: {
  usedEnergy: number;
  freeCapacity: number;
  roomName: string;
  homeRoom?: string;
  remoteRoom?: string;
  storage?: { store: { getUsedCapacity: () => number } };
}) {
  const room = {
    name: opts.roomName,
    storage: opts.storage,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_MY_STRUCTURES) {
        return [{ ...spawn, store: { getFreeCapacity: () => 100 } }];
      }
      return [];
    })
  };

  return {
    memory: {
      role: "courier",
      working: false,
      homeRoom: opts.homeRoom,
      remoteRoom: opts.remoteRoom
    },
    room,
    pos: { findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    withdraw: vi.fn().mockReturnValue(OK),
    transfer: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}

describe("courier role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing while gathering if no home room is assigned", () => {
    const creep = mockCreep({ usedEnergy: 0, freeCapacity: 50, roomName: "W1N1" });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("travels to the home room before withdrawing", () => {
    const creep = mockCreep({
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1"
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("does nothing once home if the home room has no storage yet", () => {
    const creep = mockCreep({
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W1N1",
      homeRoom: "W1N1"
    });

    run(creep);

    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("does nothing once home if storage is empty", () => {
    const creep = mockCreep({
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W1N1",
      homeRoom: "W1N1",
      storage: { store: { getUsedCapacity: () => 0 } }
    });

    run(creep);

    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("withdraws from storage once home", () => {
    const creep = mockCreep({
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W1N1",
      homeRoom: "W1N1",
      storage: { store: { getUsedCapacity: () => 500 } }
    });

    run(creep);

    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ store: expect.anything() }),
      RESOURCE_ENERGY
    );
  });

  it("moves toward storage when out of withdraw range", () => {
    const creep = mockCreep({
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W1N1",
      homeRoom: "W1N1",
      storage: { store: { getUsedCapacity: () => 500 } }
    });
    (creep.withdraw as ReturnType<typeof vi.fn>).mockReturnValue(ERR_NOT_IN_RANGE);

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(expect.objectContaining({ store: expect.anything() }), MOVE_OPTS);
  });

  it("retreats home instead of delivering when the destination room has a recent hostile sighting", () => {
    vi.stubGlobal("Game", { time: 1000 });
    vi.stubGlobal("Memory", { rooms: { W2N1: { lastHostileSeenTick: 950 } } });
    const creep = mockCreep({
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("does nothing while delivering if no destination room is assigned", () => {
    const creep = mockCreep({ usedEnergy: 50, freeCapacity: 0, roomName: "W1N1", homeRoom: "W1N1" });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("travels to the destination room before delivering", () => {
    const creep = mockCreep({
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W1N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W2N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("delivers energy once in the destination room", () => {
    const creep = mockCreep({
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spawn1" }),
      RESOURCE_ENERGY
    );
  });
});
