import { describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/scout";
import { REMOTE_MOVE_OPTS } from "../../src/roles/shared";

function mockCreep(opts: { roomName: string; remoteRoom?: string }) {
  return {
    memory: { role: "scout", working: false, remoteRoom: opts.remoteRoom },
    room: { name: opts.roomName },
    moveTo: vi.fn()
  } as unknown as Creep;
}

describe("scout role", () => {
  it("does nothing when no remote room is assigned", () => {
    const creep = mockCreep({ roomName: "W1N1" });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("travels toward the assigned remote room when not there yet", () => {
    const creep = mockCreep({ roomName: "W1N1", remoteRoom: "W2N1" });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(
      expect.objectContaining({ x: 25, y: 25, roomName: "W2N1" }),
      REMOTE_MOVE_OPTS
    );
  });

  it("does nothing further once it has arrived - its job is just to establish vision", () => {
    const creep = mockCreep({ roomName: "W2N1", remoteRoom: "W2N1" });

    run(creep);

    expect(creep.moveTo).not.toHaveBeenCalled();
  });
});
