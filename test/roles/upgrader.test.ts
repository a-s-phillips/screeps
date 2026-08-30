import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/upgrader";
import { MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const source = { id: "source1" };
const controller = { id: "controller1" };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  upgradeResult?: ScreepsReturnCode;
}) {
  const room = {
    name: "W1N1",
    controller,
    find: vi.fn().mockReturnValue([source])
  };

  return {
    memory: { role: "upgrader", working: opts.working },
    room,
    pos: { findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    harvest: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn(),
    upgradeController: vi.fn().mockReturnValue(opts.upgradeResult ?? OK)
  } as unknown as Creep;
}

describe("upgrader role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("harvests when empty", () => {
    const creep = mockCreep({ working: true, usedEnergy: 0, freeCapacity: 50 });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("upgrades the controller when full", () => {
    const creep = mockCreep({ working: false, usedEnergy: 50, freeCapacity: 0 });

    run(creep);

    expect(creep.memory.working).toBe(true);
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("moves toward the controller when out of range", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      upgradeResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(controller, MOVE_OPTS);
  });
});
