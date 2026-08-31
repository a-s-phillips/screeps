import { beforeEach, describe, expect, it, vi } from "vitest";
import { planRoom } from "../../src/planning/roomPlanner";
import { resetRoomCache } from "../../src/utils/roomCache";
import * as logger from "../../src/logging/logger";

vi.mock("../../src/logging/logger", () => ({ log: vi.fn() }));

function mockRoom(opts: {
  level: number;
  existingExtensions?: { x: number; y: number }[];
  pendingExtensionSites?: { x: number; y: number }[];
  createResult?: ScreepsReturnCode;
}) {
  const existingExtensions = opts.existingExtensions ?? [];
  const pendingExtensionSites = opts.pendingExtensionSites ?? [];
  const spawn = { pos: { x: 25, y: 25 } };

  const room = {
    name: "W1N1",
    controller: { level: opts.level, pos: { x: 40, y: 40 } },
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_MY_STRUCTURES) {
        return existingExtensions.map((p) => ({ structureType: STRUCTURE_EXTENSION, pos: p }));
      }
      if (type === FIND_MY_CONSTRUCTION_SITES) {
        return pendingExtensionSites.map((p) => ({ structureType: STRUCTURE_EXTENSION, pos: p }));
      }
      if (type === FIND_STRUCTURES) return [];
      if (type === FIND_CONSTRUCTION_SITES) return [];
      if (type === FIND_SOURCES) return [];
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

    expect(room.createConstructionSite).not.toHaveBeenCalled();
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

    expect(room.createConstructionSite).not.toHaveBeenCalled();
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
      expect.objectContaining({ room: "W1N1" })
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

    expect(room.createConstructionSite).not.toHaveBeenCalled();
  });
});
