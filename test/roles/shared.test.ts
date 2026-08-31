import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideWorkingState,
  deliverEnergy,
  findAdjacentContainerWithCapacity,
  harvestFromNearestSource,
  MOVE_OPTS
} from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

beforeEach(() => {
  resetRoomCache();
});

describe("decideWorkingState", () => {
  it("switches to harvesting (false) once the creep is empty", () => {
    expect(decideWorkingState(true, true, false)).toBe(false);
  });

  it("switches to working (true) once the creep is full", () => {
    expect(decideWorkingState(false, false, true)).toBe(true);
  });

  it("stays working when neither empty nor full", () => {
    expect(decideWorkingState(true, false, false)).toBe(true);
  });

  it("stays harvesting when neither empty nor full", () => {
    expect(decideWorkingState(false, false, false)).toBe(false);
  });
});

function mockCreep(overrides: { harvestResult?: ScreepsReturnCode; sources?: Source[] } = {}) {
  const sources = overrides.sources ?? [{ id: "source1" } as Source];

  return {
    room: {
      name: "W1N1",
      find: vi.fn().mockReturnValue(sources)
    },
    pos: {
      findClosestByPath: vi.fn().mockReturnValue(sources[0] ?? null)
    },
    harvest: vi.fn().mockReturnValue(overrides.harvestResult ?? OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}

describe("harvestFromNearestSource", () => {
  it("does nothing when there are no active sources", () => {
    const creep = mockCreep({ sources: [] });

    harvestFromNearestSource(creep);

    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("harvests without moving when already in range", () => {
    const creep = mockCreep({ harvestResult: OK });

    harvestFromNearestSource(creep);

    expect(creep.harvest).toHaveBeenCalledWith({ id: "source1" });
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("moves toward the source when out of range", () => {
    const creep = mockCreep({ harvestResult: ERR_NOT_IN_RANGE });

    harvestFromNearestSource(creep);

    expect(creep.moveTo).toHaveBeenCalledWith({ id: "source1" }, MOVE_OPTS);
  });
});

function mockDeliveryCreep(
  overrides: {
    structures?: { id: string; structureType: StructureConstant; freeCapacity: number }[];
    transferResult?: ScreepsReturnCode;
  } = {}
) {
  const structures = overrides.structures ?? [
    { id: "spawn1", structureType: STRUCTURE_SPAWN, freeCapacity: 100 }
  ];
  const targets = structures.map((s) => ({
    id: s.id,
    structureType: s.structureType,
    store: { getFreeCapacity: () => s.freeCapacity }
  }));

  return {
    room: {
      name: "W1N1",
      find: vi.fn().mockReturnValue(targets)
    },
    pos: {
      findClosestByPath: vi.fn((candidates: unknown[]) => candidates[0] ?? null)
    },
    transfer: vi.fn().mockReturnValue(overrides.transferResult ?? OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}

describe("deliverEnergy", () => {
  it("delivers to a spawn/extension with free capacity", () => {
    const creep = mockDeliveryCreep({
      structures: [{ id: "spawn1", structureType: STRUCTURE_SPAWN, freeCapacity: 100 }]
    });

    const acted = deliverEnergy(creep);

    expect(acted).toBe(true);
    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spawn1" }),
      RESOURCE_ENERGY
    );
  });

  it("moves toward the target when out of transfer range", () => {
    const creep = mockDeliveryCreep({ transferResult: ERR_NOT_IN_RANGE });

    deliverEnergy(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(expect.objectContaining({ id: "spawn1" }), MOVE_OPTS);
  });

  it("excludes structures with no free capacity, falling through to one that has some", () => {
    const creep = mockDeliveryCreep({
      structures: [
        { id: "spawn1", structureType: STRUCTURE_SPAWN, freeCapacity: 0 },
        { id: "ext1", structureType: STRUCTURE_EXTENSION, freeCapacity: 50 }
      ]
    });

    deliverEnergy(creep);

    expect(creep.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ext1" }),
      RESOURCE_ENERGY
    );
  });

  it("returns false and does not transfer when nothing needs energy", () => {
    const creep = mockDeliveryCreep({
      structures: [{ id: "spawn1", structureType: STRUCTURE_SPAWN, freeCapacity: 0 }]
    });

    const acted = deliverEnergy(creep);

    expect(acted).toBe(false);
    expect(creep.transfer).not.toHaveBeenCalled();
  });
});

function mockContainerCreep(
  pos: { x: number; y: number },
  containers: { pos: { x: number; y: number }; freeCapacity: number }[]
) {
  return {
    room: {
      name: "W1N1",
      find: vi.fn().mockReturnValue(
        containers.map((c) => ({
          structureType: STRUCTURE_CONTAINER,
          pos: c.pos,
          store: { getFreeCapacity: () => c.freeCapacity }
        }))
      )
    },
    pos
  } as unknown as Creep;
}

describe("findAdjacentContainerWithCapacity", () => {
  it("returns a container within range 1 that has free capacity", () => {
    const creep = mockContainerCreep({ x: 10, y: 10 }, [
      { pos: { x: 11, y: 10 }, freeCapacity: 50 }
    ]);

    const result = findAdjacentContainerWithCapacity(creep);

    expect(result).toEqual(expect.objectContaining({ pos: { x: 11, y: 10 } }));
  });

  it("returns undefined when no container is within range 1", () => {
    const creep = mockContainerCreep({ x: 10, y: 10 }, [
      { pos: { x: 12, y: 10 }, freeCapacity: 50 }
    ]);

    expect(findAdjacentContainerWithCapacity(creep)).toBeUndefined();
  });

  it("returns undefined when the nearby container has no free capacity", () => {
    const creep = mockContainerCreep({ x: 10, y: 10 }, [
      { pos: { x: 11, y: 10 }, freeCapacity: 0 }
    ]);

    expect(findAdjacentContainerWithCapacity(creep)).toBeUndefined();
  });
});
