import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/structures/tower";
import { resetRoomCache } from "../../src/utils/roomCache";

function mockTower(opts: {
  hostiles?: { id: string }[];
  myCreeps?: { id: string; hits: number; hitsMax: number }[];
  structures?: {
    id: string;
    structureType: StructureConstant;
    hits: number;
    hitsMax: number;
    pos?: { x: number; y: number };
  }[];
  energy?: number;
  capacity?: number;
}) {
  const hostiles = opts.hostiles ?? [];
  const myCreeps = opts.myCreeps ?? [];
  const structures = opts.structures ?? [];

  const room = {
    name: "W1N1",
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_HOSTILE_CREEPS) return hostiles;
      if (type === FIND_MY_CREEPS) return myCreeps;
      if (type === FIND_STRUCTURES) return structures;
      return [];
    })
  };

  return {
    room,
    pos: {
      findClosestByRange: vi.fn((targets: unknown[]) => targets[0] ?? null),
      getRangeTo: vi.fn((target: { pos?: { x: number; y: number } }) => {
        const p = target.pos ?? { x: 0, y: 0 };
        return Math.max(Math.abs(p.x), Math.abs(p.y));
      })
    },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.energy ?? 1000),
      getCapacity: vi.fn().mockReturnValue(opts.capacity ?? 1000)
    },
    attack: vi.fn().mockReturnValue(OK),
    heal: vi.fn().mockReturnValue(OK),
    repair: vi.fn().mockReturnValue(OK)
  } as unknown as StructureTower;
}

describe("tower run", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("attacks the closest hostile creep when one is present", () => {
    const hostile = { id: "hostile1" };
    const tower = mockTower({ hostiles: [hostile] });

    run(tower);

    expect(tower.attack).toHaveBeenCalledWith(hostile);
    expect(tower.heal).not.toHaveBeenCalled();
    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("does not heal or repair when a hostile is present, even with damaged creeps around", () => {
    const hostile = { id: "hostile1" };
    const damagedCreep = { id: "creep1", hits: 10, hitsMax: 50 };
    const tower = mockTower({ hostiles: [hostile], myCreeps: [damagedCreep] });

    run(tower);

    expect(tower.attack).toHaveBeenCalledWith(hostile);
    expect(tower.heal).not.toHaveBeenCalled();
  });

  it("heals the closest damaged own creep when no hostiles are present", () => {
    const damagedCreep = { id: "creep1", hits: 10, hitsMax: 50 };
    const tower = mockTower({ myCreeps: [damagedCreep] });

    run(tower);

    expect(tower.heal).toHaveBeenCalledWith(damagedCreep);
    expect(tower.attack).not.toHaveBeenCalled();
    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("ignores full-health creeps when looking for a heal target", () => {
    const healthyCreep = { id: "creep1", hits: 50, hitsMax: 50 };
    const tower = mockTower({ myCreeps: [healthyCreep] });

    run(tower);

    expect(tower.heal).not.toHaveBeenCalled();
  });

  it("repairs the most damaged structure when nothing needs attacking or healing", () => {
    const weakest = { id: "s1", structureType: STRUCTURE_ROAD, hits: 100, hitsMax: 5000 };
    const stronger = { id: "s2", structureType: STRUCTURE_ROAD, hits: 4000, hitsMax: 5000 };
    const tower = mockTower({ structures: [stronger, weakest] });

    run(tower);

    expect(tower.repair).toHaveBeenCalledWith(weakest);
  });

  it("excludes full-health structures from repair candidates", () => {
    const fullHealth = { id: "s1", structureType: STRUCTURE_ROAD, hits: 5000, hitsMax: 5000 };
    const tower = mockTower({ structures: [fullHealth] });

    run(tower);

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("repairs a wall below the repair cap even though it is far from full hits", () => {
    const wall = { id: "wall1", structureType: STRUCTURE_WALL, hits: 5000, hitsMax: 300000000 };
    const tower = mockTower({ structures: [wall] });

    run(tower);

    expect(tower.repair).toHaveBeenCalledWith(wall);
  });

  it("does not repair a wall once it reaches the repair cap", () => {
    const wall = { id: "wall1", structureType: STRUCTURE_WALL, hits: 50000, hitsMax: 300000000 };
    const tower = mockTower({ structures: [wall] });

    run(tower);

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("repairs a rampart below the repair cap even though it is far from full hits", () => {
    const rampart = {
      id: "rampart1",
      structureType: STRUCTURE_RAMPART,
      hits: 50000,
      hitsMax: 300000000
    };
    const tower = mockTower({ structures: [rampart] });

    run(tower);

    expect(tower.repair).toHaveBeenCalledWith(rampart);
  });

  it("does not repair a rampart once it reaches the repair cap", () => {
    const rampart = {
      id: "rampart1",
      structureType: STRUCTURE_RAMPART,
      hits: 150000,
      hitsMax: 300000000
    };
    const tower = mockTower({ structures: [rampart] });

    run(tower);

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("prefers repairing a rampart under its higher cap over a wall already at the wall cap", () => {
    const wall = { id: "wall1", structureType: STRUCTURE_WALL, hits: 50000, hitsMax: 300000000 };
    const rampart = {
      id: "rampart1",
      structureType: STRUCTURE_RAMPART,
      hits: 50000,
      hitsMax: 300000000
    };
    const tower = mockTower({ structures: [wall, rampart] });

    run(tower);

    expect(tower.repair).toHaveBeenCalledWith(rampart);
  });

  it("withholds energy below the repair reserve threshold", () => {
    const damaged = { id: "s1", structureType: STRUCTURE_ROAD, hits: 100, hitsMax: 5000 };
    const tower = mockTower({ structures: [damaged], energy: 400, capacity: 1000 });

    run(tower);

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("repairs once energy is at or above the reserve threshold", () => {
    const damaged = { id: "s1", structureType: STRUCTURE_ROAD, hits: 100, hitsMax: 5000 };
    const tower = mockTower({ structures: [damaged], energy: 500, capacity: 1000 });

    run(tower);

    expect(tower.repair).toHaveBeenCalledWith(damaged);
  });

  it("breaks a repair tie in hits by picking the closer structure", () => {
    const far = {
      id: "far",
      structureType: STRUCTURE_ROAD,
      hits: 100,
      hitsMax: 5000,
      pos: { x: 40, y: 40 }
    };
    const near = {
      id: "near",
      structureType: STRUCTURE_ROAD,
      hits: 100,
      hitsMax: 5000,
      pos: { x: 1, y: 0 }
    };
    const tower = mockTower({ structures: [far, near] });

    run(tower);

    expect(tower.repair).toHaveBeenCalledWith(near);
  });

  it("does nothing when there is nothing to attack, heal, or repair", () => {
    const tower = mockTower({});

    run(tower);

    expect(tower.attack).not.toHaveBeenCalled();
    expect(tower.heal).not.toHaveBeenCalled();
    expect(tower.repair).not.toHaveBeenCalled();
  });
});
