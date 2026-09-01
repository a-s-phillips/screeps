import { beforeEach, describe, expect, it, vi } from "vitest";
import { planRoads } from "../../src/planning/roadPlanner";
import { resetRoomCache } from "../../src/utils/roomCache";
import * as logger from "../../src/logging/logger";

vi.mock("../../src/logging/logger", () => ({ log: vi.fn() }));

function mockRoom(opts: {
  spawnPos?: { x: number; y: number };
  hasSpawn?: boolean;
  sources?: { x: number; y: number }[];
  controllerPos?: { x: number; y: number };
  existingRoads?: { x: number; y: number }[];
  pendingRoadSites?: { x: number; y: number }[];
  findPathResult?: Record<string, { x: number; y: number }[]>;
  createResult?: ScreepsReturnCode;
}) {
  const spawnPos = opts.spawnPos ?? { x: 25, y: 25 };
  const hasSpawn = opts.hasSpawn ?? true;
  const sources = opts.sources ?? [{ x: 10, y: 10 }];
  const controllerPos = opts.controllerPos ?? { x: 40, y: 40 };
  const existingRoads = opts.existingRoads ?? [];
  const pendingRoadSites = opts.pendingRoadSites ?? [];

  const spawn = { pos: spawnPos };

  const room = {
    name: "W1N1",
    controller: { pos: controllerPos },
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_MY_SPAWNS) return hasSpawn ? [spawn] : [];
      if (type === FIND_SOURCES) return sources.map((p) => ({ pos: p }));
      if (type === FIND_STRUCTURES) {
        return existingRoads.map((p) => ({ structureType: STRUCTURE_ROAD, pos: p }));
      }
      if (type === FIND_MY_CONSTRUCTION_SITES) {
        return pendingRoadSites.map((p) => ({ structureType: STRUCTURE_ROAD, pos: p }));
      }
      return [];
    }),
    findPath: vi.fn((_from: unknown, to: { x: number; y: number }) => {
      return opts.findPathResult?.[`${to.x},${to.y}`] ?? [];
    }),
    createConstructionSite: vi.fn().mockReturnValue(opts.createResult ?? OK)
  };

  return room as unknown as Room & { findPath: ReturnType<typeof vi.fn> };
}

describe("planRoads", () => {
  beforeEach(() => {
    resetRoomCache();
    vi.mocked(logger.log).mockClear();
  });

  it("does nothing when the room has no controller", () => {
    const room = { name: "W1N1", controller: undefined, find: vi.fn() } as unknown as Room;
    const memory: RoomMemory = {};

    planRoads(room, memory);

    expect((room as unknown as { find: ReturnType<typeof vi.fn> }).find).not.toHaveBeenCalled();
    expect(memory.roadPlan).toBeUndefined();
  });

  it("does nothing and does not cache a plan when there is no spawn yet", () => {
    const room = mockRoom({ hasSpawn: false });
    const memory: RoomMemory = {};

    planRoads(room, memory);

    expect(memory.roadPlan).toBeUndefined();
    expect(room.createConstructionSite).not.toHaveBeenCalled();
  });

  it("computes and caches a road plan from spawn to every source and the controller", () => {
    const room = mockRoom({
      findPathResult: {
        "10,10": [
          { x: 24, y: 25 },
          { x: 23, y: 25 }
        ],
        "40,40": [
          { x: 26, y: 25 },
          { x: 27, y: 25 }
        ]
      }
    });
    const memory: RoomMemory = {};

    planRoads(room, memory);

    expect(memory.roadPlan).toEqual([
      { x: 24, y: 25 },
      { x: 23, y: 25 },
      { x: 26, y: 25 },
      { x: 27, y: 25 }
    ]);
  });

  it("dedupes tiles shared by more than one path", () => {
    const room = mockRoom({
      findPathResult: {
        "10,10": [
          { x: 24, y: 25 },
          { x: 23, y: 25 }
        ],
        "40,40": [
          { x: 24, y: 25 },
          { x: 27, y: 25 }
        ]
      }
    });
    const memory: RoomMemory = {};

    planRoads(room, memory);

    expect(memory.roadPlan).toEqual([
      { x: 24, y: 25 },
      { x: 23, y: 25 },
      { x: 27, y: 25 }
    ]);
  });

  it("places a construction site at the first tile of a freshly computed plan and logs it", () => {
    const room = mockRoom({
      findPathResult: { "10,10": [{ x: 24, y: 25 }], "40,40": [{ x: 27, y: 25 }] }
    });
    const memory: RoomMemory = {};

    planRoads(room, memory);

    expect(room.createConstructionSite).toHaveBeenCalledWith(24, 25, STRUCTURE_ROAD);
    expect(logger.log).toHaveBeenCalledWith(
      "construction_site_planned",
      expect.objectContaining({ room: "W1N1", x: 24, y: 25, structureType: STRUCTURE_ROAD })
    );
  });

  it("reuses a cached plan on later calls instead of recomputing paths", () => {
    const room = mockRoom({});
    const memory: RoomMemory = { roadPlan: [{ x: 1, y: 1 }] };

    planRoads(room, memory);

    expect(room.findPath).not.toHaveBeenCalled();
    expect(room.createConstructionSite).toHaveBeenCalledWith(1, 1, STRUCTURE_ROAD);
  });

  it("skips plan tiles that already have a built road", () => {
    const room = mockRoom({ existingRoads: [{ x: 1, y: 1 }] });
    const memory: RoomMemory = {
      roadPlan: [
        { x: 1, y: 1 },
        { x: 2, y: 2 }
      ]
    };

    planRoads(room, memory);

    expect(room.createConstructionSite).not.toHaveBeenCalledWith(1, 1, STRUCTURE_ROAD);
    expect(room.createConstructionSite).toHaveBeenCalledWith(2, 2, STRUCTURE_ROAD);
  });

  it("skips plan tiles that already have a pending construction site", () => {
    const room = mockRoom({ pendingRoadSites: [{ x: 1, y: 1 }] });
    const memory: RoomMemory = {
      roadPlan: [
        { x: 1, y: 1 },
        { x: 2, y: 2 }
      ]
    };

    planRoads(room, memory);

    expect(room.createConstructionSite).not.toHaveBeenCalledWith(1, 1, STRUCTURE_ROAD);
    expect(room.createConstructionSite).toHaveBeenCalledWith(2, 2, STRUCTURE_ROAD);
  });

  it("does nothing once every planned tile is already built or pending", () => {
    const room = mockRoom({ existingRoads: [{ x: 1, y: 1 }], pendingRoadSites: [{ x: 2, y: 2 }] });
    const memory: RoomMemory = {
      roadPlan: [
        { x: 1, y: 1 },
        { x: 2, y: 2 }
      ]
    };

    planRoads(room, memory);

    expect(room.createConstructionSite).not.toHaveBeenCalled();
  });

  it("does not log when createConstructionSite fails", () => {
    const room = mockRoom({ createResult: ERR_NOT_ENOUGH_ENERGY });
    const memory: RoomMemory = { roadPlan: [{ x: 1, y: 1 }] };

    planRoads(room, memory);

    expect(logger.log).not.toHaveBeenCalled();
  });
});
