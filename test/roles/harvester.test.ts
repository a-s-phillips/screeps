import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/harvester";
import { MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const source = { id: "source1" };
const spawn = { id: "spawn1", structureType: STRUCTURE_SPAWN };
const controller = { id: "controller1" };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  transferResult?: ScreepsReturnCode;
  spawnFreeCapacity?: number;
  pos?: { x: number; y: number };
  containers?: { pos: { x: number; y: number }; freeCapacity: number }[];
}) {
  const containers = opts.containers ?? [];
  const pos = opts.pos ?? { x: 0, y: 0 };

  const room = {
    name: "W1N1",
    controller,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES_ACTIVE) return [source];
      if (type === FIND_MY_STRUCTURES) {
        return [
          {
            ...spawn,
            store: { getFreeCapacity: () => opts.spawnFreeCapacity ?? 100 }
          }
        ];
      }
      if (type === FIND_STRUCTURES) {
        return containers.map((c) => ({
          structureType: STRUCTURE_CONTAINER,
          pos: c.pos,
          store: { getFreeCapacity: () => c.freeCapacity }
        }));
      }
      return [];
    })
  };

  return {
    memory: { role: "harvester", working: opts.working },
    room,
    pos: { ...pos, findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    harvest: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn(),
    transfer: vi.fn().mockReturnValue(opts.transferResult ?? OK),
    upgradeController: vi.fn().mockReturnValue(OK)
  } as unknown as Creep & {
    store: { getUsedCapacity: ReturnType<typeof vi.fn>; getFreeCapacity: ReturnType<typeof vi.fn> };
  };
}

describe("harvester role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("harvests when empty", () => {
    const creep = mockCreep({ working: true, usedEnergy: 0, freeCapacity: 50 });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("transfers into an adjacent container with free capacity instead of the spawn", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 50,
      freeCapacity: 0,
      pos: { x: 5, y: 5 },
      containers: [{ pos: { x: 5, y: 6 }, freeCapacity: 50 }]
    });

    run(creep);

    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ structureType: STRUCTURE_CONTAINER }),
      RESOURCE_ENERGY
    );
    expect(creep.transfer).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "spawn1" }),
      RESOURCE_ENERGY
    );
  });

  it("ignores a nearby container with no free capacity and falls back to the spawn", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 50,
      freeCapacity: 0,
      pos: { x: 5, y: 5 },
      containers: [{ pos: { x: 5, y: 6 }, freeCapacity: 0 }]
    });

    run(creep);

    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spawn1" }),
      RESOURCE_ENERGY
    );
  });

  it("delivers energy to the spawn when full and there is no adjacent container", () => {
    const creep = mockCreep({ working: false, usedEnergy: 50, freeCapacity: 0 });

    run(creep);

    expect(creep.memory.working).toBe(true);
    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spawn1" }),
      RESOURCE_ENERGY
    );
  });

  it("moves toward the spawn when out of transfer range", () => {
    const creep = mockCreep({
      working: false,
      usedEnergy: 50,
      freeCapacity: 0,
      transferResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(expect.objectContaining({ id: "spawn1" }), MOVE_OPTS);
  });

  it("falls back to upgrading the controller when the spawn is already full and there is no container", () => {
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
});
