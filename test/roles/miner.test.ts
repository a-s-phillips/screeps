import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/miner";
import { MOVE_OPTS, REMOTE_MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

const source = { id: "source1", pos: { x: 25, y: 25 } };
const container = { id: "container1", structureType: STRUCTURE_CONTAINER, pos: { x: 26, y: 25 } };

function mockCreep(opts: {
  sourceId?: string;
  pos?: { x: number; y: number };
  hasSource?: boolean;
  hasContainer?: boolean;
  homeRoom?: string;
  remoteRoom?: string;
  gameTime?: number;
}) {
  const hasSource = opts.hasSource ?? true;
  const hasContainer = opts.hasContainer ?? true;

  const room = {
    name: "W1N1",
    find: vi.fn().mockReturnValue(hasContainer ? [container] : [])
  };

  vi.stubGlobal("Game", {
    time: opts.gameTime ?? 0,
    getObjectById: vi.fn().mockReturnValue(hasSource ? { ...source, room } : null)
  });

  return {
    memory: {
      role: "miner",
      working: false,
      sourceId: opts.sourceId,
      homeRoom: opts.homeRoom,
      remoteRoom: opts.remoteRoom
    },
    room: { name: "W2N1" },
    pos: opts.pos ?? { x: 20, y: 20 },
    harvest: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}

describe("miner role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when no sourceId is assigned", () => {
    const creep = mockCreep({ sourceId: undefined });

    run(creep);

    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("does nothing when the assigned source can't be resolved", () => {
    const creep = mockCreep({ sourceId: "source1", hasSource: false });

    run(creep);

    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("does nothing when the source has no container yet", () => {
    const creep = mockCreep({ sourceId: "source1", hasContainer: false });

    run(creep);

    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("moves to the container tile when not yet parked, and still harvests", () => {
    const creep = mockCreep({ sourceId: "source1", pos: { x: 20, y: 20 } });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ id: "container1" }),
      MOVE_OPTS
    );
    expect(creep.harvest).toHaveBeenCalledWith(expect.objectContaining({ id: "source1" }));
  });

  it("skips movement and just harvests when already parked on the container", () => {
    const creep = mockCreep({ sourceId: "source1", pos: { x: 26, y: 25 } });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
    expect(creep.harvest).toHaveBeenCalledWith(expect.objectContaining({ id: "source1" }));
  });

  it("retreats home instead of harvesting when its remote room has a recent hostile sighting", () => {
    const creep = mockCreep({
      sourceId: "source1",
      remoteRoom: "W2N1",
      homeRoom: "W1N1",
      gameTime: 1000
    });
    vi.stubGlobal("Memory", { rooms: { W2N1: { lastHostileSeenTick: 950 } } });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: "W1N1" }),
      REMOTE_MOVE_OPTS
    );
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("keeps mining when no remoteRoom is assigned, even with an unrelated hostile sighting recorded", () => {
    const creep = mockCreep({ sourceId: "source1", pos: { x: 26, y: 25 }, gameTime: 1000 });
    vi.stubGlobal("Memory", { rooms: { W2N1: { lastHostileSeenTick: 950 } } });

    run(creep);

    expect(creep.harvest).toHaveBeenCalledWith(expect.objectContaining({ id: "source1" }));
  });
});
