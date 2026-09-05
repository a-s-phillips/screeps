import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/reserver";
import { MOVE_OPTS, REMOTE_MOVE_OPTS } from "../../src/roles/shared";

function mockCreep(opts: {
  roomName: string;
  remoteRoom?: string;
  homeRoom?: string;
  hasController?: boolean;
  reservedBy?: string;
  reserveResult?: ScreepsReturnCode;
  attackResult?: ScreepsReturnCode;
}) {
  const hasController = opts.hasController ?? true;
  const controller = {
    id: "controller1",
    reservation: opts.reservedBy !== undefined ? { username: opts.reservedBy } : undefined
  };

  return {
    memory: {
      role: "reserver",
      working: false,
      remoteRoom: opts.remoteRoom,
      homeRoom: opts.homeRoom
    },
    room: { name: opts.roomName, controller: hasController ? controller : undefined },
    moveTo: vi.fn(),
    reserveController: vi.fn().mockReturnValue(opts.reserveResult ?? OK),
    attackController: vi.fn().mockReturnValue(opts.attackResult ?? OK)
  } as unknown as Creep;
}

describe("reserver role", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retreats home instead of reserving when the remote room has a recent hostile sighting", () => {
    vi.stubGlobal("Game", { time: 1000 });
    vi.stubGlobal("Memory", { rooms: { W2N1: { lastHostileSeenTick: 950 } } });
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", homeRoom: "W1N1" });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.reserveController).not.toHaveBeenCalled();
  });

  it("does nothing when no remote room is assigned", () => {
    const creep = mockCreep({ roomName: "W1N1" });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
    expect(creep.reserveController).not.toHaveBeenCalled();
  });

  it("travels toward the remote room before trying to reserve", () => {
    const creep = mockCreep({ roomName: "W1N1", remoteRoom: "W2N1" });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W2N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.reserveController).not.toHaveBeenCalled();
  });

  it("reserves the controller once in the remote room", () => {
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1" });

    run(creep);

    expect(creep.reserveController).toHaveBeenCalledWith(creep.room.controller);
    expect(creep.attackController).not.toHaveBeenCalled();
  });

  it("moves to the controller when out of reserve range", () => {
    const creep = mockCreep({
      roomName: "W2N1",
      remoteRoom: "W2N1",
      reserveResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(creep.room.controller, MOVE_OPTS);
  });

  it("does nothing once in the remote room if it unexpectedly has no controller", () => {
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", hasController: false });

    run(creep);

    expect(creep.reserveController).not.toHaveBeenCalled();
    expect(creep.attackController).not.toHaveBeenCalled();
  });

  it("reserves normally when the controller is already reserved by us", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", reservedBy: "me" });

    run(creep);

    expect(creep.reserveController).toHaveBeenCalledWith(creep.room.controller);
    expect(creep.attackController).not.toHaveBeenCalled();
  });

  it("attacks the reservation instead of reserving when a rival holds it", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", reservedBy: "ender2012" });

    run(creep);

    expect(creep.attackController).toHaveBeenCalledWith(creep.room.controller);
    expect(creep.reserveController).not.toHaveBeenCalled();
  });

  it("moves to the controller when out of range while attacking a rival's reservation", () => {
    vi.stubGlobal("Game", { spawns: { Spawn1: { owner: { username: "me" } } } });
    const creep = mockCreep({
      roomName: "W2N1",
      remoteRoom: "W2N1",
      reservedBy: "ender2012",
      attackResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(creep.room.controller, MOVE_OPTS);
  });
});
