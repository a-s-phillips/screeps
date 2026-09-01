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
  containers?: { id: string; usedCapacity: number }[];
  buildResult?: ScreepsReturnCode;
  upgradeResult?: ScreepsReturnCode;
}) {
  const sites = opts.sites ?? [site];
  const containers = opts.containers ?? [];
  const room = {
    name: "W1N1",
    controller,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES_ACTIVE) return [source];
      if (type === FIND_CONSTRUCTION_SITES) return sites;
      if (type === FIND_STRUCTURES) {
        return containers.map((c) => ({
          id: c.id,
          structureType: STRUCTURE_CONTAINER,
          store: { getUsedCapacity: () => c.usedCapacity }
        }));
      }
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
    withdraw: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn(),
    build: vi.fn().mockReturnValue(opts.buildResult ?? OK),
    upgradeController: vi.fn().mockReturnValue(opts.upgradeResult ?? OK)
  } as unknown as Creep;
}

describe("builder role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("harvests when empty and no container has energy", () => {
    const creep = mockCreep({ working: true, usedEnergy: 0, freeCapacity: 50 });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("withdraws from a container instead of harvesting when one has energy", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      containers: [{ id: "container1", usedCapacity: 50 }]
    });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ id: "container1" }),
      RESOURCE_ENERGY
    );
    expect(creep.harvest).not.toHaveBeenCalled();
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

  it("prioritizes a container construction site over other site types, regardless of order", () => {
    // A container unlocks a miner (a real economy upgrade) - worth building even if it's
    // farther away than an extension/road, which "closest site" targeting alone would
    // never guarantee (found live: a source's container sat at 0 progress indefinitely
    // while builders kept converging on closer, ever-replenishing extensions/roads).
    const otherSite = { id: "site1", structureType: STRUCTURE_EXTENSION };
    const containerSite = { id: "site2", structureType: STRUCTURE_CONTAINER };
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      sites: [otherSite, containerSite]
    });

    run(creep);

    expect(creep.build).toHaveBeenCalledWith(containerSite);
  });

  it("falls back to the closest site of any type when there are no container sites", () => {
    const siteA = { id: "site1", structureType: STRUCTURE_EXTENSION };
    const siteB = { id: "site2", structureType: STRUCTURE_ROAD };
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      sites: [siteA, siteB]
    });

    run(creep);

    expect(creep.build).toHaveBeenCalledWith(siteA);
  });
});
