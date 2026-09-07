import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/reserver";
import { MOVE_OPTS, REMOTE_MOVE_OPTS } from "../../src/roles/shared";

function mockCreep(opts: {
  roomName: string;
  remoteRoom?: string;
  homeRoom?: string;
  hasController?: boolean;
  controllerMy?: boolean;
  reservedBy?: string;
  reserveResult?: ScreepsReturnCode;
  attackResult?: ScreepsReturnCode;
  claimResult?: ScreepsReturnCode;
}) {
  const hasController = opts.hasController ?? true;
  const controller = {
    id: "controller1",
    my: opts.controllerMy ?? false,
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
    attackController: vi.fn().mockReturnValue(opts.attackResult ?? OK),
    claimController: vi.fn().mockReturnValue(opts.claimResult ?? OK)
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

  it("claims the controller instead of reserving once GCL allows another room and this is the designated claim target", () => {
    vi.stubGlobal("Game", {
      gcl: { level: 2 },
      rooms: { W1N1: { controller: { my: true } } }
    });
    vi.stubGlobal("Memory", { rooms: { W1N1: { claimTarget: "W2N1" } } });
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", homeRoom: "W1N1" });

    run(creep);

    expect(creep.claimController).toHaveBeenCalledWith(creep.room.controller);
    expect(creep.reserveController).not.toHaveBeenCalled();
    expect(creep.attackController).not.toHaveBeenCalled();
  });

  it("moves to the controller when out of range while claiming", () => {
    vi.stubGlobal("Game", {
      gcl: { level: 2 },
      rooms: { W1N1: { controller: { my: true } } }
    });
    vi.stubGlobal("Memory", { rooms: { W1N1: { claimTarget: "W2N1" } } });
    const creep = mockCreep({
      roomName: "W2N1",
      remoteRoom: "W2N1",
      homeRoom: "W1N1",
      claimResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(creep.room.controller, MOVE_OPTS);
  });

  it("keeps reserving instead of claiming when GCL doesn't allow another room yet", () => {
    vi.stubGlobal("Game", {
      gcl: { level: 1 },
      rooms: { W1N1: { controller: { my: true } } }
    });
    vi.stubGlobal("Memory", { rooms: { W1N1: { claimTarget: "W2N1" } } });
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", homeRoom: "W1N1" });

    run(creep);

    expect(creep.reserveController).toHaveBeenCalledWith(creep.room.controller);
    expect(creep.claimController).not.toHaveBeenCalled();
  });

  it("keeps reserving when this remote room isn't the designated claim target", () => {
    vi.stubGlobal("Game", {
      gcl: { level: 2 },
      rooms: { W1N1: { controller: { my: true } } }
    });
    vi.stubGlobal("Memory", { rooms: { W1N1: { claimTarget: "W3N1" } } });
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", homeRoom: "W1N1" });

    run(creep);

    expect(creep.reserveController).toHaveBeenCalledWith(creep.room.controller);
    expect(creep.claimController).not.toHaveBeenCalled();
  });

  it("does nothing once the room has already been claimed", () => {
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1", controllerMy: true });

    run(creep);

    expect(creep.reserveController).not.toHaveBeenCalled();
    expect(creep.attackController).not.toHaveBeenCalled();
    expect(creep.claimController).not.toHaveBeenCalled();
  });
});
