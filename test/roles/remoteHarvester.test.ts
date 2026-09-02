import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/remoteHarvester";
import { REMOTE_MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const source = { id: "source1" };
const spawn = { id: "spawn1", structureType: STRUCTURE_SPAWN };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  roomName: string;
  homeRoom?: string;
  remoteRoom?: string;
}) {
  const room = {
    name: opts.roomName,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES_ACTIVE) return [source];
      if (type === FIND_MY_STRUCTURES) {
        return [{ ...spawn, store: { getFreeCapacity: () => 100 } }];
      }
      return [];
    })
  };

  return {
    memory: {
      role: "remoteHarvester",
      working: opts.working,
      homeRoom: opts.homeRoom,
      remoteRoom: opts.remoteRoom
    },
    room,
    pos: { findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    harvest: vi.fn().mockReturnValue(OK),
    transfer: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}

describe("remoteHarvester role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retreats home instead of harvesting when the remote room has a recent hostile sighting", () => {
    vi.stubGlobal("Game", { time: 1000 });
    vi.stubGlobal("Memory", { rooms: { W2N1: { lastHostileSeenTick: 950 } } });
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("keeps delivering toward home even when the remote room has a recent hostile sighting", () => {
    vi.stubGlobal("Game", { time: 1000 });
    vi.stubGlobal("Memory", { rooms: { W2N1: { lastHostileSeenTick: 950 } } });
    const creep = mockCreep({
      working: false,
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

  it("does nothing while gathering if no remote room is assigned", () => {
    const creep = mockCreep({ working: true, usedEnergy: 0, freeCapacity: 50, roomName: "W1N1" });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("travels to the remote room before harvesting", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W1N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W2N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("harvests the nearest active source once in the remote room", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("does nothing while delivering if no home room is assigned", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("travels to the home room before delivering", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      homeRoom: "W1N1"
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("delivers energy once back in the home room", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W1N1",
      homeRoom: "W1N1"
    });

    run(creep);

    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spawn1" }),
      RESOURCE_ENERGY
    );
  });
});
