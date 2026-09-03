import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isKeeperWindowReachable,
  KEEPER_RETREAT_LEAD_TICKS,
  recordKeeperIntel
} from "../../src/planning/keeperTargeting";
import { resetRoomCache } from "../../src/utils/roomCache";

function mockRoom(lairs: { ticksToSpawn?: number }[]) {
  return {
    name: "W8N7",
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_HOSTILE_STRUCTURES) {
        return lairs.map((lair) => ({ ...lair, structureType: STRUCTURE_KEEPER_LAIR }));
      }
      return [];
    })
  } as unknown as Room;
}

describe("recordKeeperIntel", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not record anything for a room with no keeper lairs", () => {
    const memory: RoomMemory = {};

    recordKeeperIntel(mockRoom([]), memory);

    expect(memory.keeperIntel).toBeUndefined();
  });

  it("records null nextWindowCloseTick when every lair has a live guard (ticksToSpawn undefined)", () => {
    vi.stubGlobal("Game", { time: 1000 });
    const memory: RoomMemory = {};

    recordKeeperIntel(mockRoom([{ ticksToSpawn: undefined }, { ticksToSpawn: undefined }]), memory);

    expect(memory.keeperIntel).toEqual({ nextWindowCloseTick: null, observedAt: 1000 });
  });

  it("records the soonest respawn as an absolute tick when any lair is counting down", () => {
    vi.stubGlobal("Game", { time: 1000 });
    const memory: RoomMemory = {};

    recordKeeperIntel(mockRoom([{ ticksToSpawn: 250 }, { ticksToSpawn: 90 }]), memory);

    expect(memory.keeperIntel).toEqual({ nextWindowCloseTick: 1090, observedAt: 1000 });
  });

  it("overwrites a previous observation", () => {
    vi.stubGlobal("Game", { time: 1000 });
    const memory: RoomMemory = { keeperIntel: { nextWindowCloseTick: 500, observedAt: 200 } };

    recordKeeperIntel(mockRoom([{ ticksToSpawn: 300 }]), memory);

    expect(memory.keeperIntel).toEqual({ nextWindowCloseTick: 1300, observedAt: 1000 });
  });
});

describe("isKeeperWindowReachable", () => {
  it("is true (bootstrap) when the room has never been observed", () => {
    expect(isKeeperWindowReachable(undefined, 1000, 50)).toBe(true);
  });

  it("is false when the last observation shows every lair fully guarded", () => {
    const intel: KeeperIntel = { nextWindowCloseTick: null, observedAt: 900 };

    expect(isKeeperWindowReachable(intel, 1000, 50)).toBe(false);
  });

  it("is true when arrival plus the retreat lead time still fits before the window closes", () => {
    const intel: KeeperIntel = { nextWindowCloseTick: 1200, observedAt: 900 };

    expect(isKeeperWindowReachable(intel, 1000, 50)).toBe(true);
  });

  it("is false when arrival would land inside the retreat lead time before the window closes", () => {
    const intel: KeeperIntel = { nextWindowCloseTick: 1200, observedAt: 900 };

    expect(isKeeperWindowReachable(intel, 1000, 200)).toBe(false);
  });

  it("treats landing exactly at the retreat lead time boundary as unreachable", () => {
    const intel: KeeperIntel = {
      nextWindowCloseTick: 1000 + 50 + KEEPER_RETREAT_LEAD_TICKS,
      observedAt: 900
    };

    expect(isKeeperWindowReachable(intel, 1000, 50)).toBe(true);
    expect(
      isKeeperWindowReachable(
        { ...intel, nextWindowCloseTick: intel.nextWindowCloseTick! - 1 },
        1000,
        50
      )
    ).toBe(false);
  });
});
