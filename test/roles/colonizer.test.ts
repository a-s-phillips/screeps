import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/colonizer";
import { MOVE_OPTS, REMOTE_MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const source = { id: "source1", pos: { x: 20, y: 20 } };
const controller = { id: "controller1", my: true };
const spawnSite = { id: "site1", structureType: STRUCTURE_SPAWN };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  roomName: string;
  homeRoom?: string;
  remoteRoom?: string;
  sites?: unknown[];
  containers?: { id: string; usedCapacity: number; pos?: { x: number; y: number } }[];
  sources?: unknown[];
  buildResult?: ScreepsReturnCode;
  upgradeResult?: ScreepsReturnCode;
  hasController?: boolean;
  controllerMy?: boolean;
  ticksToDowngrade?: number;
}) {
  const sites = opts.sites ?? [spawnSite];
  const containers = opts.containers ?? [];
  const sources = opts.sources ?? [source];
  const hasController = opts.hasController ?? true;

  const room = {
    name: opts.roomName,
    controller: hasController
      ? { ...controller, my: opts.controllerMy ?? true, ticksToDowngrade: opts.ticksToDowngrade }
      : undefined,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES_ACTIVE) return sources;
      if (type === FIND_CONSTRUCTION_SITES) return sites;
      if (type === FIND_STRUCTURES) {
        return containers.map((c) => ({
          id: c.id,
          structureType: STRUCTURE_CONTAINER,
          pos: c.pos ?? { x: 1, y: 0 },
          store: { getUsedCapacity: () => c.usedCapacity }
        }));
      }
      return [];
    })
  };

  return {
    memory: {
      role: "colonizer",
      working: opts.working,
      homeRoom: opts.homeRoom,
      remoteRoom: opts.remoteRoom
    },
    room,
    pos: { x: 0, y: 0, findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    harvest: vi.fn().mockReturnValue(OK),
    withdraw: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn(),
    build: vi.fn().mockReturnValue(opts.buildResult ?? OK),
    upgradeController: vi.fn().mockReturnValue(opts.upgradeResult ?? OK)
  } as unknown as Creep;
}

describe("colonizer role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when no remote room is assigned", () => {
    const creep = mockCreep({ working: true, usedEnergy: 0, freeCapacity: 50, roomName: "W1N1" });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("retreats home instead of working when the remote room has a recent hostile sighting", () => {
    vi.stubGlobal("Game", { time: 1000, rooms: {} });
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
    expect(creep.build).not.toHaveBeenCalled();
  });

  it("travels to the remote room before doing anything else", () => {
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

  it("harvests when empty and no container has energy", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("withdraws from a container instead of harvesting when one has energy", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      containers: [{ id: "container1", usedCapacity: 50 }]
    });

    run(creep);

    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ id: "container1" }),
      RESOURCE_ENERGY
    );
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("builds the spawn site once full", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      remoteRoom: "W2N1"
    });

    run(creep);

    expect(creep.memory.working).toBe(true);
    expect(creep.build).toHaveBeenCalledWith(spawnSite);
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  it("moves toward the site when out of range", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      buildResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(spawnSite, MOVE_OPTS);
  });

  it("prioritizes the spawn site over other site types, regardless of order", () => {
    const otherSite = { id: "siteA", structureType: STRUCTURE_EXTENSION };
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sites: [otherSite, spawnSite]
    });

    run(creep);

    expect(creep.build).toHaveBeenCalledWith(spawnSite);
  });

  it("falls back to the closest site of any type when there is no spawn site", () => {
    const siteA = { id: "siteA", structureType: STRUCTURE_EXTENSION };
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sites: [siteA]
    });

    run(creep);

    expect(creep.build).toHaveBeenCalledWith(siteA);
  });

  it("falls back to upgrading the controller when there are no construction sites", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sites: []
    });

    run(creep);

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("idles once full when pre-positioned ahead of a claim that hasn't landed yet", () => {
    // A colonizer can be dispatched before the room is actually ours (see
    // remoteSpawnManager.ts's decideColonizerSpawn pre-claim branch) - there's no site to
    // build yet (planSpawn only runs once owned) and upgradeController would error on a
    // controller we don't own, so it should just wait.
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sites: [],
      controllerMy: false
    });

    run(creep);

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.upgradeController).not.toHaveBeenCalled();
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("does nothing once full if there are no sites and unexpectedly no controller", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      roomName: "W2N1",
      remoteRoom: "W2N1",
      sites: [],
      hasController: false
    });

    run(creep);

    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  describe("downgrade failsafe", () => {
    it("spends energy on the controller instead of building when the downgrade timer is critically low", () => {
      const creep = mockCreep({
        working: true,
        usedEnergy: 50,
        freeCapacity: 0,
        roomName: "W2N1",
        remoteRoom: "W2N1",
        sites: [spawnSite],
        ticksToDowngrade: 4999
      });

      run(creep);

      expect(creep.upgradeController).toHaveBeenCalledWith(
        expect.objectContaining({ id: "controller1" })
      );
      expect(creep.build).not.toHaveBeenCalled();
    });

    it("moves toward the controller when out of range during the failsafe", () => {
      const creep = mockCreep({
        working: true,
        usedEnergy: 50,
        freeCapacity: 0,
        roomName: "W2N1",
        remoteRoom: "W2N1",
        sites: [spawnSite],
        ticksToDowngrade: 100,
        upgradeResult: ERR_NOT_IN_RANGE
      });

      run(creep);

      expect(creep.moveTo).toHaveBeenCalledWith(
        expect.objectContaining({ id: "controller1" }),
        MOVE_OPTS
      );
    });

    it("does not trigger the failsafe when the creep has no energy to spend", () => {
      const creep = mockCreep({
        working: false,
        usedEnergy: 0,
        freeCapacity: 50,
        roomName: "W2N1",
        remoteRoom: "W2N1",
        sites: [spawnSite],
        ticksToDowngrade: 100
      });

      run(creep);

      expect(creep.upgradeController).not.toHaveBeenCalled();
      expect(creep.harvest).toHaveBeenCalled();
    });

    it("does not trigger the failsafe when the downgrade timer has a comfortable buffer", () => {
      const creep = mockCreep({
        working: true,
        usedEnergy: 50,
        freeCapacity: 0,
        roomName: "W2N1",
        remoteRoom: "W2N1",
        sites: [spawnSite],
        ticksToDowngrade: 5000
      });

      run(creep);

      expect(creep.upgradeController).not.toHaveBeenCalled();
      expect(creep.build).toHaveBeenCalledWith(spawnSite);
    });

    it("does not trigger the failsafe on a controller we don't own yet", () => {
      const creep = mockCreep({
        working: true,
        usedEnergy: 50,
        freeCapacity: 0,
        roomName: "W2N1",
        remoteRoom: "W2N1",
        sites: [spawnSite],
        controllerMy: false,
        ticksToDowngrade: 100
      });

      run(creep);

      expect(creep.upgradeController).not.toHaveBeenCalled();
    });
  });
});
