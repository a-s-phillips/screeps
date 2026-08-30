import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/builder";
import { MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const source = { id: "source1" };
const controller = { id: "controller1" };
const site = { id: "site1" };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  sites?: unknown[];
  buildResult?: ScreepsReturnCode;
  upgradeResult?: ScreepsReturnCode;
}) {
  const sites = opts.sites ?? [site];
  const room = {
    name: "W1N1",
    controller,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES_ACTIVE) return [source];
      if (type === FIND_CONSTRUCTION_SITES) return sites;
      return [];
    })
  };

  return {
    memory: { role: "builder", working: opts.working },
    room,
    pos: { findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    harvest: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn(),
    build: vi.fn().mockReturnValue(opts.buildResult ?? OK),
    upgradeController: vi.fn().mockReturnValue(opts.upgradeResult ?? OK)
  } as unknown as Creep;
}

describe("builder role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("harvests when empty", () => {
    const creep = mockCreep({ working: true, usedEnergy: 0, freeCapacity: 50 });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("builds the nearest construction site when full", () => {
    const creep = mockCreep({ working: false, usedEnergy: 50, freeCapacity: 0 });

    run(creep);

    expect(creep.memory.working).toBe(true);
    expect(creep.build).toHaveBeenCalledWith(site);
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  it("moves toward the construction site when out of range", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      buildResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(site, MOVE_OPTS);
  });

  it("falls back to upgrading the controller when there are no construction sites", () => {
    const creep = mockCreep({ working: true, usedEnergy: 50, freeCapacity: 0, sites: [] });

    run(creep);

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });
});
