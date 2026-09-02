import { describe, expect, it } from "vitest";
import { buildRemoteTargets } from "../src/main";

function mockRoom(name: string): Room {
  return { name } as unknown as Room;
}

describe("buildRemoteTargets", () => {
  it("includes every remote room from a single home room's remoteRooms list", () => {
    const result = buildRemoteTargets([mockRoom("W9N8")], {
      W9N8: { remoteRooms: ["W8N8", "W9N7"] }
    });

    expect(result).toEqual(new Set(["W8N8", "W9N7"]));
  });

  it("aggregates remote rooms across multiple home rooms", () => {
    const result = buildRemoteTargets([mockRoom("W9N8"), mockRoom("W5N5")], {
      W9N8: { remoteRooms: ["W8N8"] },
      W5N5: { remoteRooms: ["W5N4"] }
    });

    expect(result).toEqual(new Set(["W8N8", "W5N4"]));
  });

  it("contributes nothing for a home room with an empty remoteRooms list", () => {
    const result = buildRemoteTargets([mockRoom("W9N8")], { W9N8: { remoteRooms: [] } });

    expect(result).toEqual(new Set());
  });

  it("contributes nothing for a home room with no memory entry at all", () => {
    const result = buildRemoteTargets([mockRoom("W9N8")], {});

    expect(result).toEqual(new Set());
  });

  it("returns an empty set when there are no owned rooms", () => {
    expect(buildRemoteTargets([], {})).toEqual(new Set());
  });
});
