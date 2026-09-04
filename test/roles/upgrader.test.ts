import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/roles/upgrader";
import { MOVE_OPTS } from "../../src/roles/shared";
import { resetRoomCache } from "../../src/utils/roomCache";

// Far from the default creep pos (0,0) - keeps the default scenario "no active source
// closer than a container", so existing tests still exercise the withdraw/harvest
// fallback path unless a test deliberately overrides positions.
const source = { id: "source1", pos: { x: 20, y: 20 } };
// Far from every other test's container positions (all near {0,0}-{10,0}) so
// findControllerContainer only ever matches a container deliberately placed adjacent to
// it - existing scenarios keep exercising gatherEnergy's own source-vs-container logic
// unchanged.
const controller = { id: "controller1", pos: { x: 25, y: 25 }, my: true };

function mockCreep(opts: {
  working: boolean;
  usedEnergy: number;
  freeCapacity: number;
  upgradeResult?: ScreepsReturnCode;
  containers?: { id: string; usedCapacity: number; pos?: { x: number; y: number } }[];
  sources?: unknown[];
  pos?: { x: number; y: number };
}) {
  const containers = opts.containers ?? [];
  const sources = opts.sources ?? [source];
  const pos = opts.pos ?? { x: 0, y: 0 };

  const room = {
    name: "W1N1",
    controller,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_STRUCTURES) {
        return containers.map((c) => ({
          id: c.id,
          structureType: STRUCTURE_CONTAINER,
          // Close to the default creep pos (0,0) - keeps the default scenario
          // "container is closer than the far-off default source" unless overridden.
          pos: c.pos ?? { x: 1, y: 0 },
          store: { getUsedCapacity: () => c.usedCapacity }
        }));
      }
      if (type === FIND_SOURCES_ACTIVE) return sources;
      return [];
    })
  };

  return {
    memory: { role: "upgrader", working: opts.working },
    room,
    pos: { ...pos, findClosestByPath: vi.fn((targets: unknown[]) => targets[0] ?? null) },
    store: {
      getUsedCapacity: vi.fn().mockReturnValue(opts.usedEnergy),
      getFreeCapacity: vi.fn().mockReturnValue(opts.freeCapacity)
    },
    harvest: vi.fn().mockReturnValue(OK),
    withdraw: vi.fn().mockReturnValue(OK),
    moveTo: vi.fn(),
    upgradeController: vi.fn().mockReturnValue(opts.upgradeResult ?? OK)
  } as unknown as Creep;
}

describe("upgrader role", () => {
  beforeEach(() => {
    resetRoomCache();
  });

  it("harvests when empty and no container has energy", () => {
    const creep = mockCreep({ working: true, usedEnergy: 0, freeCapacity: 50 });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("withdraws from a container instead of harvesting when one has energy", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      containers: [{ id: "container1", usedCapacity: 50 }]
    });

    run(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ id: "container1" }),
      RESOURCE_ENERGY
    );
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("upgrades the controller when full", () => {
    const creep = mockCreep({ working: false, usedEnergy: 50, freeCapacity: 0 });

    run(creep);

    expect(creep.memory.working).toBe(true);
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("moves toward the controller when out of range", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 50,
      freeCapacity: 0,
      upgradeResult: ERR_NOT_IN_RANGE
    });

    run(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(controller, MOVE_OPTS);
  });

  it("harvests a source that's closer than the fullest container", () => {
    const nearbySource = { id: "source1", pos: { x: 1, y: 0 } };
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      sources: [nearbySource],
      containers: [{ id: "container1", usedCapacity: 50, pos: { x: 10, y: 0 } }]
    });

    run(creep);

    expect(creep.harvest).toHaveBeenCalledWith(nearbySource);
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("withdraws from a container that's closer than the nearest active source", () => {
    const farSource = { id: "source1", pos: { x: 10, y: 0 } };
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      sources: [farSource],
      containers: [{ id: "container1", usedCapacity: 50, pos: { x: 1, y: 0 } }]
    });

    run(creep);

    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ id: "container1" }),
      RESOURCE_ENERGY
    );
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  // Regression coverage for the upgrader-starvation fix: gatherEnergy's "nearest source
  // vs. globally fullest container" comparison ignores proximity to the creep's own
  // local container, so a stationary upgrader could walk right past its own
  // partially-full controller container to a fuller one elsewhere in the room.
  it("withdraws from its own controller-adjacent container even when a farther container has more energy", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      containers: [
        { id: "controllerContainer1", usedCapacity: 50, pos: { x: 26, y: 25 } },
        { id: "fullerContainer1", usedCapacity: 500, pos: { x: 1, y: 0 } }
      ]
    });

    run(creep);

    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ id: "controllerContainer1" }),
      RESOURCE_ENERGY
    );
  });

  it("falls back to the general gather logic once its own controller container is empty", () => {
    const creep = mockCreep({
      working: true,
      usedEnergy: 0,
      freeCapacity: 50,
      containers: [
        { id: "controllerContainer1", usedCapacity: 0, pos: { x: 26, y: 25 } },
        { id: "otherContainer1", usedCapacity: 50, pos: { x: 1, y: 0 } }
      ]
    });

    run(creep);

    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ id: "otherContainer1" }),
      RESOURCE_ENERGY
    );
  });
});
