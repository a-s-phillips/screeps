import { beforeEach, describe, expect, it, vi } from "vitest";
import { planRoom } from "../../src/planning/roomPlanner";
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
  createResult?: ScreepsReturnCode;
}) {
  const existingExtensions = opts.existingExtensions ?? [];
  const pendingExtensionSites = opts.pendingExtensionSites ?? [];
  const sources = opts.sources ?? [];
  const existingContainers = opts.existingContainers ?? [];
  const pendingContainerSites = opts.pendingContainerSites ?? [];
  const spawn = { pos: { x: 25, y: 25 } };

  const room = {
    name: "W1N1",
    controller: { level: opts.level, pos: { x: 40, y: 40 } },
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_MY_STRUCTURES) {
        return existingExtensions.map((p) => ({ structureType: STRUCTURE_EXTENSION, pos: p }));
      }
      if (type === FIND_STRUCTURES) {
        return existingContainers.map((p) => ({ structureType: STRUCTURE_CONTAINER, pos: p }));
      }
      if (type === FIND_MY_CONSTRUCTION_SITES) {
        return [
          ...pendingExtensionSites.map((p) => ({ structureType: STRUCTURE_EXTENSION, pos: p })),
          ...pendingContainerSites.map((p) => ({ structureType: STRUCTURE_CONTAINER, pos: p }))
        ];
      }
      if (type === FIND_CONSTRUCTION_SITES) return [];
      if (type === FIND_SOURCES) return sources.map((p) => ({ pos: p }));
      if (type === FIND_MY_SPAWNS) return [spawn];
      return [];
    }),
    getTerrain: vi.fn(() => ({ get: () => 0 })),
    createConstructionSite: vi.fn().mockReturnValue(opts.createResult ?? OK)
  };

  return room as unknown as Room;
}

describe("planRoom", () => {
  beforeEach(() => {
    resetRoomCache();
    vi.mocked(logger.log).mockClear();
  });

  it("does nothing when the room has no controller", () => {
    const room = { name: "W1N1", controller: undefined, find: vi.fn() } as unknown as Room;

    planRoom(room);

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

      planRoom(room);

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

      planRoom(room);

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_EXTENSION
      );
    });

    it("places a new extension site and logs it when under the cap", () => {
      const room = mockRoom({ level: 2 });

      planRoom(room);

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

      planRoom(room);

      expect(logger.log).not.toHaveBeenCalled();
    });

    it("does nothing when there is no spawn to anchor on", () => {
      const room = mockRoom({ level: 2 });
      (room.find as ReturnType<typeof vi.fn>).mockImplementation((type: FindConstant) => {
        if (type === FIND_MY_SPAWNS) return [];
        return [];
      });

      planRoom(room);

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

      planRoom(room);

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

    it("does not place a container when a built one already covers the source", () => {
      const room = mockRoom({
        level: 2,
        sources: [{ x: 10, y: 10 }],
        existingContainers: [{ x: 11, y: 10 }]
      });

      planRoom(room);

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
      );
    });

    it("does not place a container when a pending site already covers the source", () => {
      const room = mockRoom({
        level: 2,
        sources: [{ x: 10, y: 10 }],
        pendingContainerSites: [{ x: 11, y: 10 }]
      });

      planRoom(room);

      expect(room.createConstructionSite).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
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

      planRoom(room);

      const containerCalls = (
        room.createConstructionSite as ReturnType<typeof vi.fn>
      ).mock.calls.filter(([, , structureType]) => structureType === STRUCTURE_CONTAINER);
      expect(containerCalls).toHaveLength(1);
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

      planRoom(room);

      expect(room.createConstructionSite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        STRUCTURE_CONTAINER
      );
    });
  });
});
