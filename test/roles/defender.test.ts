import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/defender";
import { MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const spawn = { id: "spawn1", structureType: STRUCTURE_SPAWN };

function mockCreep(opts: { hostiles?: { id: string }[]; attackResult?: ScreepsReturnCode }) {
  const hostiles = opts.hostiles ?? [];

  const room = {
    name: "W1N1",
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_HOSTILE_CREEPS) return hostiles;
      if (type === FIND_MY_SPAWNS) return [spawn];
      return [];
    })
  };

  return {
    room,
    pos: {
      findClosestByRange: vi.fn((targets: unknown[]) => targets[0] ?? null)
    },
    attack: vi.fn().mockReturnValue(opts.attackResult ?? OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}

describe("defender run", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("attacks the closest hostile when already in range", () => {
    const hostile = { id: "hostile1" };
    const creep = mockCreep({ hostiles: [hostile] });

    run(creep);

    expect(creep.attack).toHaveBeenCalledWith(hostile);
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("moves toward the closest hostile when out of range", () => {
    const hostile = { id: "hostile1" };
    const creep = mockCreep({ hostiles: [hostile], attackResult: ERR_NOT_IN_RANGE });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(hostile, MOVE_OPTS);
  });

  it("rallies to the room's spawn when no hostile is present", () => {
    const creep = mockCreep({});

    run(creep);

    expect(creep.attack).not.toHaveBeenCalled();
    expect(creep.moveTo).toHaveBeenCalledWith(spawn, MOVE_OPTS);
  });

  it("does nothing when there is no hostile and no spawn to rally to", () => {
    const creep = mockCreep({});
    (creep.room.find as ReturnType<typeof vi.fn>).mockImplementation((type: FindConstant) => {
      if (type === FIND_MY_SPAWNS) return [];
      return [];
    });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
  });
});
