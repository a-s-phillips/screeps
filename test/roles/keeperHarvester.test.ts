import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/keeperHarvester";
import { MOVE_OPTS, REMOTE_MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const spawn = { id: "spawn1", structureType: STRUCTURE_SPAWN };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  roomName: string;
  homeRoom?: string;
  remoteRoom?: string;
  sources?: { id: string; pos: { x: number; y: number } }[];
  lairs?: { id: string; pos: { x: number; y: number }; ticksToSpawn?: number }[];
  hostiles?: { id: string; owner: { username: string }; pos: { x: number; y: number } }[];
  harvestResult?: ScreepsReturnCode;
}) {
  const sources = opts.sources ?? [];
  const lairs = (opts.lairs ?? []).map((l) => ({ ...l, structureType: STRUCTURE_KEEPER_LAIR }));
  const hostiles = opts.hostiles ?? [];

  const room = {
    name: opts.roomName,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES_ACTIVE) return sources;
      if (type === FIND_HOSTILE_STRUCTURES) return lairs;
      if (type === FIND_HOSTILE_CREEPS) return hostiles;
      if (type === FIND_MY_STRUCTURES) {
        return [{ ...spawn, store: { getFreeCapacity: () => 100 } }];
      }
      return [];
    })
  };

  return {
    memory: {
      role: "keeperHarvester",
      working: opts.working,
      homeRoom: opts.homeRoom,
      remoteRoom: opts.remoteRoom
    },
    room,
    pos: {
      x: 0,
      y: 0,
      findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null)
    },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    harvest: vi.fn().mockReturnValue(opts.harvestResult ?? OK),
    transfer: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}

describe("keeperHarvester role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing while gathering if no remote room is assigned", () => {
    const creep = mockCreep({ working: false, usedEnergy: 0, freeCapacity: 50, roomName: "W1N1" });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("travels to the remote room before doing anything else", () => {
    const creep = mockCreep({
      working: false,
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

  it("retreats toward home on a real (non-Source-Keeper) hostile", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      hostiles: [{ id: "h1", owner: { username: "SomePlayer" }, pos: { x: 10, y: 10 } }]
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("retreats toward home when a live Source Keeper is within the retreat radius, regardless of ticksToSpawn", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      lairs: [{ id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: 500 }],
      hostiles: [{ id: "k1", owner: { username: "Source Keeper" }, pos: { x: 2, y: 0 } }]
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("does not immediately head back toward the remote room the tick after retreating", () => {
    // Found live: without a persisted cooldown, the creep's very next tick re-attempts
    // travelToRoom(remoteRoom) unconditionally before the safety check ever runs again,
    // undoing the retreat it just started and thrashing back and forth across the room
    // border for its whole remaining life without ever getting a real chance to wait out
    // an unsafe window.
    vi.stubGlobal("Game", { time: 1000 });
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W1N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      hostiles: [{ id: "h1", owner: { username: "SomePlayer" }, pos: { x: 10, y: 10 } }]
    });
    creep.memory.keeperRetreatUntil = 1050;

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W2N1" }),
      REMOTE_MOVE_OPTS
    );
  });

  it("sets a retreat cooldown when retreating from a hostile", () => {
    vi.stubGlobal("Game", { time: 1000 });
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      hostiles: [{ id: "h1", owner: { username: "SomePlayer" }, pos: { x: 10, y: 10 } }]
    });

    run(creep);

    expect(creep.memory.keeperRetreatUntil).toBeGreaterThan(1000);
  });

  it("resumes heading to the remote room once the retreat cooldown has passed", () => {
    vi.stubGlobal("Game", { time: 1051 });
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W1N1",
      remoteRoom: "W2N1"
    });
    creep.memory.keeperRetreatUntil = 1050;

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W2N1" }),
      REMOTE_MOVE_OPTS
    );
  });

  it("does not retreat from a Source Keeper creep outside the retreat radius", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      lairs: [{ id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: 500 }],
      hostiles: [{ id: "k1", owner: { username: "Source Keeper" }, pos: { x: 40, y: 40 } }]
    });

    run(creep);

    expect(creep.harvest).toHaveBeenCalledWith({ id: "s1", pos: { x: 10, y: 10 } });
  });

  it("harvests a source whose nearest lair's ticksToSpawn is comfortably above the threshold", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      lairs: [{ id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: 500 }]
    });

    run(creep);

    expect(creep.harvest).toHaveBeenCalledWith({ id: "s1", pos: { x: 10, y: 10 } });
  });

  it("does not harvest a source whose nearest lair's ticksToSpawn is below the threshold", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      lairs: [{ id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: 50 }]
    });

    run(creep);

    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
  });

  it("does not harvest a source whose nearest lair has an active Keeper (ticksToSpawn undefined)", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      lairs: [{ id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: undefined }]
    });

    run(creep);

    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("treats ticksToSpawn exactly at the threshold as unsafe", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      lairs: [{ id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: 100 }]
    });

    run(creep);

    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("harvests a farther safe source instead of giving up when the nearest source is unsafe", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sources: [
        { id: "unsafe", pos: { x: 10, y: 10 } },
        { id: "safe", pos: { x: 30, y: 30 } }
      ],
      lairs: [
        { id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: undefined },
        { id: "lair2", pos: { x: 30, y: 29 }, ticksToSpawn: 500 }
      ]
    });

    run(creep);

    expect(creep.harvest).toHaveBeenCalledWith({ id: "safe", pos: { x: 30, y: 30 } });
  });

  it("heads home when every source is unsafe", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      homeRoom: "W1N1",
      remoteRoom: "W2N1",
      sources: [
        { id: "s1", pos: { x: 10, y: 10 } },
        { id: "s2", pos: { x: 30, y: 30 } }
      ],
      lairs: [
        { id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: 10 },
        { id: "lair2", pos: { x: 30, y: 29 }, ticksToSpawn: 10 }
      ]
    });

    run(creep);

    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
  });

  it("treats a source with no nearby lair as safe", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      lairs: []
    });

    run(creep);

    expect(creep.harvest).toHaveBeenCalledWith({ id: "s1", pos: { x: 10, y: 10 } });
  });

  it("moves toward the source when out of harvest range", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sources: [{ id: "s1", pos: { x: 10, y: 10 } }],
      lairs: [{ id: "lair1", pos: { x: 10, y: 9 }, ticksToSpawn: 500 }],
      harvestResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), MOVE_OPTS);
  });

  it("does nothing while delivering if no home room is assigned", () => {
    const creep = mockCreep({
      working: true,
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
      working: true,
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
      working: true,
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
