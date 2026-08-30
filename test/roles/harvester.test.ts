import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/harvester";
import { MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const source = { id: "source1" };
const spawn = { id: "spawn1" };
const controller = { id: "controller1" };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  transferResult?: ScreepsReturnCode;
  spawnFreeCapacity?: number;
}) {
  const room = {
    name: "W1N1",
    controller,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES_ACTIVE) return [source];
      if (type === FIND_MY_SPAWNS) return [spawn];
      return [];
    })
  };

  return {
    memory: { role: "harvester", working: opts.working },
    room,
    pos: { findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
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

function mockSpawnStore(creep: ReturnType<typeof mockCreep>, freeCapacity: number) {
  (creep.room.find as ReturnType<typeof vi.fn>).mockImplementation((type: FindConstant) => {
    if (type === FIND_SOURCES_ACTIVE) return [source];
    if (type === FIND_MY_SPAWNS)
      return [{ ...spawn, store: { getFreeCapacity: () => freeCapacity } }];
    return [];
  });
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

  it("delivers energy to the spawn when full and the spawn needs energy", () => {
    const creep = mockCreep({ working: false, usedEnergy: 50, freeCapacity: 0 });
    mockSpawnStore(creep, 100);

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
    mockSpawnStore(creep, 100);

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(expect.objectContaining({ id: "spawn1" }), MOVE_OPTS);
  });

  it("falls back to upgrading the controller when the spawn is already full", () => {
    const creep = mockCreep({ working: true, usedEnergy: 50, freeCapacity: 0 });
    mockSpawnStore(creep, 0);

    run(creep);

    expect(creep.transfer).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });
});
