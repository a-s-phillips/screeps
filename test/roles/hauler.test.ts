import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/hauler";
import { MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const container = { id: "container1", structureType: STRUCTURE_CONTAINER, pos: { x: 10, y: 10 } };
const controllerContainer = {
  id: "controllerContainer1",
  structureType: STRUCTURE_CONTAINER,
  pos: { x: 41, y: 40 }
};
const spawn = { id: "spawn1", structureType: STRUCTURE_SPAWN };
const controller = { id: "controller1", pos: { x: 40, y: 40 } };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  withdrawResult?: ScreepsReturnCode;
  transferResult?: ScreepsReturnCode;
  hasContainer?: boolean;
  spawnFreeCapacity?: number;
  controllerContainerFreeCapacity?: number;
}) {
  const hasContainer = opts.hasContainer ?? true;

  const structures: {
    id: string;
    structureType: StructureConstant;
    pos: { x: number; y: number };
    store: { getUsedCapacity: () => number; getFreeCapacity: () => number };
  }[] = [];
  if (hasContainer) {
    structures.push({ ...container, store: { getUsedCapacity: () => 50, getFreeCapacity: () => 0 } });
  }
  const controllerContainerFreeCapacity = opts.controllerContainerFreeCapacity;
  if (controllerContainerFreeCapacity !== undefined) {
    structures.push({
      ...controllerContainer,
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => controllerContainerFreeCapacity }
    });
  }

  const room = {
    name: "W1N1",
    controller,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_STRUCTURES) return structures;
      if (type === FIND_MY_STRUCTURES) {
        return [
          {
            ...spawn,
            store: { getFreeCapacity: () => opts.spawnFreeCapacity ?? 100 }
          }
        ];
      }
      return [];
    })
  };

  return {
    memory: { role: "hauler", working: opts.working },
    room,
    pos: { findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    withdraw: vi.fn().mockReturnValue(opts.withdrawResult ?? OK),
    transfer: vi.fn().mockReturnValue(opts.transferResult ?? OK),
    moveTo: vi.fn(),
    upgradeController: vi.fn().mockReturnValue(OK)
  } as unknown as Creep & {
    store: { getUsedCapacity: ReturnType<typeof vi.fn>; getFreeCapacity: ReturnType<typeof vi.fn> };
  };
}

describe("hauler role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("withdraws from the closest container with energy when empty", () => {
    const creep = mockCreep({ working: false, usedEnergy: 0, freeCapacity: 100 });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ id: "container1" }),
      RESOURCE_ENERGY
    );
  });

  it("moves toward the container when out of withdraw range", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 100,
      withdrawResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ id: "container1" }),
      MOVE_OPTS
    );
  });

  it("does nothing when no container has energy", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 0,
      freeCapacity: 100,
      hasContainer: false
    });

    run(creep);

    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("delivers energy to the spawn when full and it needs energy", () => {
    const creep = mockCreep({ working: true, usedEnergy: 50, freeCapacity: 0 });

    run(creep);

    expect(creep.memory.working).toBe(true);
    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spawn1" }),
      RESOURCE_ENERGY
    );
  });

  it("tops off the controller container when the spawn/extensions are full", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      spawnFreeCapacity: 0,
      controllerContainerFreeCapacity: 50
    });

    run(creep);

    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "controllerContainer1" }),
      RESOURCE_ENERGY
    );
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  it("falls back to upgrading the controller when nothing needs energy", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      spawnFreeCapacity: 0
    });

    run(creep);

    expect(creep.transfer).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("falls back to upgrading when the controller container is full", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      spawnFreeCapacity: 0,
      controllerContainerFreeCapacity: 0
    });

    run(creep);

    expect(creep.transfer).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });
});
