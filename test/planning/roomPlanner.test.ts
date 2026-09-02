import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLocalHostileRecentlySeen,
  planRamparts,
  planRoom,
  planTowers
} from "../../src/planning/roomPlanner";
import { resetRoomCache } from "../../src/utils/roomCache";
import * as logger from "../../src/logging/logger";

vi.mock("../../src/logging/logger", () => ({ log: vi.fn() }));

function mockRoom(opts: {
  level: number;
  existingExtensions?: { x: number; y: number }[];
  pendingExtensionSites?: { x: number; y: number }[];
  sources?: { x: number; y: number }[];
  existingContainers?: { x: number; y: number }[];
  pendingContainerSites?: { x: number; y: number }[];
  existingRoads?: { x: number; y: number }[];
  pendingRoadSites?: { x: number; y: number }[];
  existingTowers?: { x: number; y: number }[];
  pendingTowerSites?: { x: number; y: number }[];
  existingRamparts?: { x: number; y: number }[];
  pendingRampartSites?: { x: number; y: number }[];
  createResult?: ScreepsReturnCode;
  findPathResult?: { x: number; y: number }[];
  isMine?: boolean;
}) {
  const existingExtensions = opts.existingExtensions ?? [];
  const pendingExtensionSites = opts.pendingExtensionSites ?? [];
  const sources = opts.sources ?? [];
  const existingContainers = opts.existingContainers ?? [];
  const pendingContainerSites = opts.pendingContainerSites ?? [];
  const existingRoads = opts.existingRoads ?? [];
  const pendingRoadSites = opts.pendingRoadSites ?? [];
  const existingTowers = opts.existingTowers ?? [];
  const pendingTowerSites = opts.pendingTowerSites ?? [];
  const existingRamparts = opts.existingRamparts ?? [];
  const pendingRampartSites = opts.pendingRampartSites ?? [];
  const spawn = { pos: { x: 25, y: 25 } };

  const room = {
    name: "W1N1",
    controller: { level: opts.level, pos: { x: 40, y: 40 }, my: opts.isMine ?? true },
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_MY_STRUCTURES) {
        return [
          ...existingExtensions.map((p) => ({ structureType: STRUCTURE_EXTENSION, pos: p })),
          ...existingTowers.map((p) => ({ structureType: STRUCTURE_TOWER, pos: p })),
          ...existingRamparts.map((p) => ({ structureType: STRUCTURE_RAMPART, pos: p }))
        ];
      }
      if (type === FIND_STRUCTURES) {
        return [
          ...existingContainers.map((p) => ({ structureType: STRUCTURE_CONTAINER, pos: p })),
          ...existingRoads.map((p) => ({ structureType: STRUCTURE_ROAD, pos: p }))
        ];
      }
      if (type === FIND_MY_CONSTRUCTION_SITES) {
        return [
          ...pendingExtensionSites.map((p) => ({ structureType: STRUCTURE_EXTENSION, pos: p })),
          ...pendingContainerSites.map((p) => ({ structureType: STRUCTURE_CONTAINER, pos: p })),
          ...pendingRoadSites.map((p) => ({ structureType: STRUCTURE_ROAD, pos: p })),
          ...pendingTowerSites.map((p) => ({ structureType: STRUCTURE_TOWER, pos: p })),
          ...pendingRampartSites.map((p) => ({ structureType: STRUCTURE_RAMPART, pos: p }))
        ];
      }
      if (type === FIND_CONSTRUCTION_SITES) return [];
      if (type === FIND_SOURCES) return sources.map((p) => ({ pos: p }));
      if (type === FIND_MY_SPAWNS) return [spawn];
      return [];
    }),
    getTerrain: vi.fn(() => ({ get: () => 0 })),
    createConstructionSite: vi.fn().mockReturnValue(opts.createResult ?? OK),
    findPath: vi.fn().mockReturnValue(opts.findPathResult ?? [])
  };

  return room as unknown as Room;
}

describe("planRoom", () => {
  beforeEach(() => {
    resetRoomCache();
    vi.mocked(logger.log).mockClear();
    vi.stubGlobal("Game", { time: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when the room has no controller", () => {
    const room = { name: "W1N1", controller: undefined, find: vi.fn() } as unknown as Room;

    planRoom(room, {});

    expect((room as unknown as { find: ReturnType<typeof vi.fn> }).find).not.toHaveBeenCalled();
  });

  describe("extensions", () => {
    it("does nothing when already at the extension cap for this RCL", () => {
      const room = mockRoom({
        level: 2,
        existingExtensions: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
          { x: 4, y: 4 },
          { x: 5, y: 5 }
        ]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_EXTENSION
      );
    });

    it("counts pending construction sites toward the cap, not just built extensions", () => {
      const room = mockRoom({
        level: 2,
        existingExtensions: [{ x: 1, y: 1 }],
        pendingExtensionSites: [
          { x: 2, y: 2 },
          { x: 3, y: 3 },
          { x: 4, y: 4 },
          { x: 5, y: 5 }
        ]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_EXTENSION
      );
    });

    it("places a new extension site and logs it when under the cap", () => {
      const room = mockRoom({ level: 2 });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_EXTENSION
      );
      expect(logger.log).toHaveBeenCalledWith(
        "construction_site_planned",
        expect.objectContaining({ room: "W1N1", structureType: STRUCTURE_EXTENSION })
      );
    });

    it("does not log when createConstructionSite fails", () => {
      const room = mockRoom({ level: 2, createResult: ERR_NOT_ENOUGH_ENERGY });

      planRoom(room, { roadPlan: [] });

      expect(logger.log).not.toHaveBeenCalled();
    });

    it("places an extension on a tile that already has a road, since roads don't block other structures", () => {
      // Real Screeps allows roads to coexist with almost any other structure - this
      // reproduces the live pserver bug where buildOccupancy treated an existing road
      // as blocking, permanently starving a source of its only viable container tile.
      const room = mockRoom({ level: 2, existingRoads: [{ x: 23, y: 23 }] });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(23, 23, STRUCTURE_EXTENSION);
    });

    it("does nothing when there is no spawn to anchor on", () => {
      const room = mockRoom({ level: 2 });
      (room.find as ReturnType<typeof vi.fn>).mockImplementation((type: FindConstant) => {
        if (type === FIND_MY_SPAWNS) return [];
        return [];
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_EXTENSION
      );
    });
  });

  describe("containers", () => {
    it("places a container adjacent to a source that has none nearby", () => {
      const room = mockRoom({ level: 2, sources: [{ x: 10, y: 10 }] });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
      );
      expect(logger.log).toHaveBeenCalledWith(
        "construction_site_planned",
        expect.objectContaining({ room: "W1N1", structureType: STRUCTURE_CONTAINER })
      );
    });

    it("does not place a container when a built one already covers the source and the controller", () => {
      const room = mockRoom({
        level: 2,
        sources: [{ x: 10, y: 10 }],
        existingContainers: [
          { x: 11, y: 10 },
          { x: 41, y: 40 }
        ]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
      );
    });

    it("does not place a container when a pending site already covers the source and the controller", () => {
      const room = mockRoom({
        level: 2,
        sources: [{ x: 10, y: 10 }],
        pendingContainerSites: [
          { x: 11, y: 10 },
          { x: 41, y: 40 }
        ]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
      );
    });

    it("places a container adjacent to the controller once every source is already covered", () => {
      const room = mockRoom({
        level: 2,
        sources: [{ x: 10, y: 10 }],
        existingContainers: [{ x: 11, y: 10 }]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
      );
      expect(logger.log).toHaveBeenCalledWith(
        "construction_site_planned",
        expect.objectContaining({ room: "W1N1", structureType: STRUCTURE_CONTAINER })
      );
    });

    it("places at most one container site per call, moving on to the next uncovered source next time", () => {
      const room = mockRoom({
        level: 2,
        sources: [
          { x: 10, y: 10 },
          { x: 20, y: 20 }
        ]
      });

      planRoom(room, { roadPlan: [] });

      const containerCalls = (
        room.createConstructionSite as ReturnType<typeof vi.fn>
      ).mock.calls.filter(([, , structureType]) => structureType === STRUCTURE_CONTAINER);
      expect(containerCalls).toHaveLength(1);
    });

    it("places a container on a tile that already has a road, since roads don't block other structures", () => {
      // Reproduces the live pserver bug: a source's only walkable adjacent tile
      // already has a road (built by roadPlanner's spawn->source pathing, since
      // it's the only way in). Roads don't block placement in real Screeps, so a
      // container should still land there instead of being skipped forever.
      const room = mockRoom({
        level: 2,
        sources: [{ x: 10, y: 10 }],
        existingRoads: [{ x: 9, y: 9 }]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(9, 9, STRUCTURE_CONTAINER);
    });

    it("skips a source with no free adjacent tile and still covers a later source", () => {
      const room = mockRoom({
        level: 2,
        sources: [
          { x: 0, y: 25 },
          { x: 20, y: 20 }
        ]
      });
      (room.getTerrain as ReturnType<typeof vi.fn>).mockReturnValue({
        get: (x: number) => (x <= 1 ? TERRAIN_MASK_WALL : 0)
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
      );
    });

    it("does not anchor a container on the controller when the room isn't owned", () => {
      // A container is allowed at RCL 0 (the flat CONTROLLER_STRUCTURES.container table),
      // so an unowned room's controller would otherwise burn one of the 5 slots on a
      // spot we'll never benefit from upgrading - found live: this ran, unmodified,
      // for any room a scout merely passed through.
      const room = mockRoom({
        level: 0,
        isMine: false,
        sources: [{ x: 10, y: 10 }],
        existingContainers: [{ x: 11, y: 10 }]
      });

      planRoom(room, { roadPlan: [] }, true);

      expect(room.createConstructionSite).not.toHaveBeenCalled();
    });
  });

  describe("ownership guard", () => {
    it("skips extensions, roads, and towers entirely for a room that isn't owned", () => {
      const room = mockRoom({ level: 2, isMine: false, existingExtensions: [] });

      planRoom(room, { roadPlan: [] }, true);

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_EXTENSION
      );
      expect(room.findPath).not.toHaveBeenCalled();
    });

    it("still plans containers for an unowned room passed in as a remote-mining target", () => {
      const room = mockRoom({ level: 0, isMine: false, sources: [{ x: 10, y: 10 }] });

      planRoom(room, { roadPlan: [] }, true);

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
      );
    });

    it("does nothing at all for an unowned room that is not a remote-mining target", () => {
      const room = mockRoom({ level: 0, isMine: false, sources: [{ x: 10, y: 10 }] });

      planRoom(room, { roadPlan: [] }, false);

      expect(room.createConstructionSite).not.toHaveBeenCalled();
    });

    it("defaults to the room's own ownership when no explicit flag is passed", () => {
      const room = mockRoom({ level: 0, isMine: false, sources: [{ x: 10, y: 10 }] });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalled();
    });
  });

  describe("roads", () => {
    it("computes and caches a road plan into the passed room memory", () => {
      const room = mockRoom({ level: 2, findPathResult: [{ x: 24, y: 25 }] });
      const memory: RoomMemory = {};

      planRoom(room, memory);

      expect(memory.roadPlan).toContainEqual({ x: 24, y: 25 });
      expect(room.createConstructionSite).toHaveBeenCalledWith(24, 25, STRUCTURE_ROAD);
    });

    it("reuses an already-cached road plan without recomputing paths", () => {
      const room = mockRoom({ level: 2 });
      const memory: RoomMemory = { roadPlan: [{ x: 1, y: 1 }] };

      planRoom(room, memory);

      expect(room.findPath).not.toHaveBeenCalled();
      expect(room.createConstructionSite).toHaveBeenCalledWith(1, 1, STRUCTURE_ROAD);
    });
  });

  describe("towers", () => {
    // Extension cap at RCL3 is 10 (test/setup.ts) - fill it so planExtensions reports done.
    const extensionsAtCap = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));

    it("does nothing when already at the tower cap for RCL", () => {
      const room = mockRoom({
        level: 3,
        existingExtensions: extensionsAtCap,
        existingTowers: [{ x: 30, y: 30 }]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_TOWER
      );
    });

    it("does not place a tower while extensions still need building", () => {
      const room = mockRoom({ level: 3 });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_TOWER
      );
    });

    it("does not place a tower while roads still need building", () => {
      const room = mockRoom({ level: 3, existingExtensions: extensionsAtCap });

      planRoom(room, { roadPlan: [{ x: 1, y: 1 }] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_TOWER
      );
    });

    it("places a tower once both the extension and road queues are empty", () => {
      const room = mockRoom({ level: 3, existingExtensions: extensionsAtCap });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_TOWER
      );
      expect(logger.log).toHaveBeenCalledWith(
        "construction_site_planned",
        expect.objectContaining({ room: "W1N1", structureType: STRUCTURE_TOWER })
      );
    });

    it("places a tower when a hostile was seen recently, even with extensions/roads pending", () => {
      vi.stubGlobal("Game", { time: 500 });
      const room = mockRoom({ level: 3 });

      planRoom(room, { roadPlan: [{ x: 1, y: 1 }], lastHostileSeenTick: 200 });

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_TOWER
      );
    });

    it("does not place a tower when the last hostile sighting is outside the memory window", () => {
      vi.stubGlobal("Game", { time: 5000 });
      const room = mockRoom({ level: 3 });

      planRoom(room, { roadPlan: [{ x: 1, y: 1 }], lastHostileSeenTick: 200 });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_TOWER
      );
    });

    it("places a tower when overridePriority is explicitly true, regardless of the other gates", () => {
      const room = mockRoom({ level: 3 });

      planTowers(room, false, false, true);

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_TOWER
      );
    });
  });

  describe("ramparts", () => {
    // Extension cap at RCL3 is 10 (test/setup.ts) - fill it so planExtensions reports done.
    const extensionsAtCap = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));

    it("places a rampart on the spawn's tile when none exists there yet", () => {
      const room = mockRoom({ level: 3, existingExtensions: extensionsAtCap });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(25, 25, STRUCTURE_RAMPART);
      expect(logger.log).toHaveBeenCalledWith(
        "construction_site_planned",
        expect.objectContaining({ room: "W1N1", structureType: STRUCTURE_RAMPART })
      );
    });

    it("places a rampart on an existing tower's tile once the spawn is already ramparted", () => {
      const room = mockRoom({
        level: 3,
        existingExtensions: extensionsAtCap,
        existingRamparts: [{ x: 25, y: 25 }],
        existingTowers: [{ x: 30, y: 30 }]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).toHaveBeenCalledWith(30, 30, STRUCTURE_RAMPART);
    });

    it("does not place a rampart on a spawn tile that already has one", () => {
      const room = mockRoom({
        level: 3,
        existingExtensions: extensionsAtCap,
        existingRamparts: [{ x: 25, y: 25 }]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_RAMPART
      );
    });

    it("does not place a rampart on a spawn tile that already has a pending rampart site", () => {
      const room = mockRoom({
        level: 3,
        existingExtensions: extensionsAtCap,
        pendingRampartSites: [{ x: 25, y: 25 }]
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_RAMPART
      );
    });

    it("places at most one rampart site per call, moving on to the next uncovered anchor next time", () => {
      const room = mockRoom({
        level: 3,
        existingExtensions: extensionsAtCap,
        existingTowers: [{ x: 30, y: 30 }]
      });

      planRoom(room, { roadPlan: [] });

      const rampartCalls = (
        room.createConstructionSite as ReturnType<typeof vi.fn>
      ).mock.calls.filter(([, , structureType]) => structureType === STRUCTURE_RAMPART);
      expect(rampartCalls).toHaveLength(1);
    });

    it("does nothing when there is no spawn or tower to anchor on", () => {
      const room = mockRoom({ level: 3, existingExtensions: extensionsAtCap });
      (room.find as ReturnType<typeof vi.fn>).mockImplementation((type: FindConstant) => {
        if (type === FIND_MY_SPAWNS) return [];
        return [];
      });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_RAMPART
      );
    });

    it("does not place a rampart while extensions still need building", () => {
      const room = mockRoom({ level: 3 });

      planRoom(room, { roadPlan: [] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_RAMPART
      );
    });

    it("does not place a rampart while roads still need building", () => {
      const room = mockRoom({ level: 3, existingExtensions: extensionsAtCap });

      planRoom(room, { roadPlan: [{ x: 1, y: 1 }] });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_RAMPART
      );
    });

    it("places a rampart when a hostile was seen recently, even with extensions/roads pending", () => {
      vi.stubGlobal("Game", { time: 500 });
      const room = mockRoom({ level: 3 });

      planRoom(room, { roadPlan: [{ x: 1, y: 1 }], lastHostileSeenTick: 200 });

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_RAMPART
      );
    });

    it("does not place a rampart when the last hostile sighting is outside the memory window", () => {
      vi.stubGlobal("Game", { time: 5000 });
      const room = mockRoom({ level: 3 });

      planRoom(room, { roadPlan: [{ x: 1, y: 1 }], lastHostileSeenTick: 200 });

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_RAMPART
      );
    });

    it("places a rampart when overridePriority is explicitly true, regardless of the other gates", () => {
      const room = mockRoom({ level: 3 });

      planRamparts(room, false, false, true);

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_RAMPART
      );
    });

    it("does nothing below RCL2, where CONTROLLER_STRUCTURES.rampart is 0", () => {
      const room = mockRoom({ level: 1 });

      planRamparts(room, false, false, true);

      expect(room.createConstructionSite).not.toHaveBeenCalled();
    });
  });

  describe("isLocalHostileRecentlySeen", () => {
    it("is true when the sighting is within the memory window", () => {
      expect(isLocalHostileRecentlySeen(200, 500)).toBe(true);
    });

    it("is false when the sighting is outside the memory window", () => {
      expect(isLocalHostileRecentlySeen(200, 5000)).toBe(false);
    });

    it("is false when there is no recorded sighting", () => {
      expect(isLocalHostileRecentlySeen(undefined, 500)).toBe(false);
    });
  });
});
