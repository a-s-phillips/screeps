import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/defender";
import { MOVE_OPTS, REMOTE_MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const spawn = { id: "spawn1", structureType: STRUCTURE_SPAWN };
const controller = { id: "controller1" };

function mockCreep(opts: {
  hostiles?: { id: string }[];
  attackResult?: ScreepsReturnCode;
  roomName?: string;
  remoteRoom?: string;
  spawns?: { id: string; structureType: string }[];
  controller?: { id: string };
}) {
  const hostiles = opts.hostiles ?? [];
  const roomName = opts.roomName ?? "W1N1";
  const spawns = opts.spawns ?? [spawn];

  const room = {
    name: roomName,
    controller: opts.controller,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_HOSTILE_CREEPS) return hostiles;
      if (type === FIND_MY_SPAWNS) return spawns;
      return [];
    })
  };

  return {
    memory: { role: "defender", remoteRoom: opts.remoteRoom },
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

  it("does nothing when there is no hostile, no spawn, and no controller to rally to", () => {
    const creep = mockCreep({ spawns: [] });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("falls back to the controller when there is no hostile and no spawn yet", () => {
    // Found live: a defender with genuinely nothing to do (no hostile, no spawn) would
    // just idle in place - and if that place happened to be the exact border tile it
    // crossed on, the engine could revert it to the room it came from with zero move
    // intent issued, producing an unbounded per-tick ping-pong. Falling back to the
    // controller (guaranteed once the room is claimed) walks it off that tile instead,
    // same as colonizer/reserver's own "nothing else to do" fallback.
    const creep = mockCreep({ spawns: [], controller });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(controller, MOVE_OPTS);
  });

  it("travels to the remote room before fighting, instead of retreating from a hostile there", () => {
    const creep = mockCreep({ roomName: "W1N1", remoteRoom: "W2N1" });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W2N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.attack).not.toHaveBeenCalled();
  });

  it("attacks a hostile once it has arrived at the remote room", () => {
    const hostile = { id: "hostile1" };
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", hostiles: [hostile] });

    run(creep);

    expect(creep.attack).toHaveBeenCalledWith(hostile);
  });
});
