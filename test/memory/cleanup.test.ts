import { describe, expect, it, vi } from "vitest";
import { cleanUpDeadCreepMemory } from "../../src/memory/cleanup";
import * as logger from "../../src/logging/logger";

vi.mock("../../src/logging/logger", () => ({ log: vi.fn() }));

describe("cleanUpDeadCreepMemory", () => {
  it("removes memory entries for creeps that no longer exist", () => {
    const memory = { creeps: { alive: {}, dead: {} } } as unknown as Memory;
    const creeps = { alive: {} } as unknown as { [name: string]: Creep };

    cleanUpDeadCreepMemory(memory, creeps);

    expect(memory.creeps).toEqual({ alive: {} });
  });

  it("leaves memory untouched when all creeps are alive", () => {
    const memory = { creeps: { alive: {} } } as unknown as Memory;
    const creeps = { alive: {} } as unknown as { [name: string]: Creep };

    cleanUpDeadCreepMemory(memory, creeps);

    expect(memory.creeps).toEqual({ alive: {} });
  });

  it("logs a creep_died event with the creep's role for each departed creep", () => {
    vi.mocked(logger.log).mockClear();
    const memory = {
      creeps: { dead: { role: "harvester", working: false } }
    } as unknown as Memory;
    const creeps = {} as unknown as { [name: string]: Creep };

    cleanUpDeadCreepMemory(memory, creeps);

    expect(logger.log).toHaveBeenCalledWith("creep_died", { role: "harvester", name: "dead" });
  });

  it("does not log anything when no creeps died", () => {
    vi.mocked(logger.log).mockClear();
    const memory = { creeps: { alive: {} } } as unknown as Memory;
    const creeps = { alive: {} } as unknown as { [name: string]: Creep };

    cleanUpDeadCreepMemory(memory, creeps);

    expect(logger.log).not.toHaveBeenCalled();
  });
});
